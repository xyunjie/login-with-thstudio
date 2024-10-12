import {
    Context, ForbiddenError, Handler, superagent, SystemModel,
    UserFacingError, TokenModel
} from 'hydrooj';

declare module 'hydrooj' {
    interface SystemKeys {
        'login-with-thstudio.id': string;
        'login-with-thstudio.secret': string;
        'login-with-thstudio.endpoint': string;
    }
}

// 当用户点击 【使用 XX 登录】 按钮时，此函数会被执行
async function get(this: Handler) {
    // 从系统设置中获取基础设置，并储存状态信息（完成登录逻辑后应该跳转到哪一页）
    const [appid, oauth_url, url, [state]] = await Promise.all([
        SystemModel.get('login-with-thstudio.id'),
        SystemModel.get('login-with-thstudio.endpoint'),
        SystemModel.get('server.url'),
        TokenModel.add(TokenModel.TYPE_OAUTH, 600, { redirect: this.request.referer }),
    ]);
    // 将用户重定向至第三方平台请求授权。
    this.response.redirect = `${oauth_url || 'https://admin.tihangstudio.cn'}/oauth2/authorize?response_type=code&client_id=${appid}&redirect_uri=${url}oauth/thstudio/callback&state=${state}&scope=userinfo,openid`;
}

// 当用户在三方系统中完成授权，需要重定向到 /oauth/xxx/callback，这时所有返回的参数作为 callback 的一参数传入。
async function callback({ state, code }) {
    console.log('进入回调函数');
    
    // 获取系统设置和之前的状态。
    const [[appid, secret, endpoint, url], s] = await Promise.all([
        SystemModel.getMany([
            'login-with-thstudio.id',
            'login-with-thstudio.secret',
            'login-with-thstudio.endpoint',
            'server.url',
        ]),
        TokenModel.get(state, TokenModel.TYPE_OAUTH),
    ]);
    console.log('步骤一');
    // 使用从 url 中返回的 token 请求第三方的 API，获取用户信息，作为函数返回。
    // 在 OAuth 协议中，需要使用 state 和 code 换取 access_token 再调用 API，这在不同系统中可能设计不同。
    // 系统会根据返回的用户信息自动查找已有用户或是创建新用户。
    const tokenApi = `${endpoint || 'https://admin.tihangstudio.cn'}/oauth2/token?grant_type=authorization_code&client_id=${appid}&client_secret=${secret}&code=${code}`;
    console.log('TokenAPi', tokenApi);
    const res = await superagent.get(tokenApi);
    console.log('请求token');
    if (res.body.error) {
        throw new UserFacingError(
            res.body.error, res.body.error_description, res.body.error_uri,
        );
    }
    const t = res.body.access_token;
    const userInfoApi = `${endpoint || 'https://admin.tihangstudio.cn'}/oauth2/userinfo?access_token=${t}`;
    const userInfo = await superagent.get(userInfoApi)
        .set('User-Agent', 'Hydro-OAuth')
        .set('Accept', 'application/vnd.github.v3+json');
    console.log('请求用户信息', userInfoApi);
    console.log(userInfo.body)
    const ret = {
        _id: `${userInfo.body.openId}`,
        email: userInfo.body.email,
        // 提供多个用户名，若需创建用户则从前往后尝试，直到用户名可用
        uname: `${userInfo.body.name}`,
        studentId: userInfo.body.studentId,
        ojUid: userInfo.body.ojUid,
        avatar: `url:${userInfo.body.avatar}`,
    };
    await TokenModel.del(state, TokenModel.TYPE_OAUTH);
    this.response.redirect = s.redirect;
    if (!ret.email) throw new ForbiddenError("您没有经过验证的电子邮件。");
    return ret;
}

// 注册此模块。
export function apply(ctx: Context) {
    ctx.provideModule('oauth', 'thstudio', {
        text: 'Login with ThStudio',
        callback,
        get,
    });
    ctx.i18n.load('zh', {
        'Login with ThStudio': '使用 梯航Studio 登录',
    });
}