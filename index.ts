import {
    Context, Handler, Schema, Service, superagent, SystemModel,
    TokenModel, UserFacingError, ForbiddenError,
} from 'hydrooj';

export default class ThStudioOAuthService extends Service {
    static inject = ['oauth'];
    static Config = Schema.object({
        id: Schema.string().description('ThStudio OAuth AppID').required(),
        secret: Schema.string().description('ThStudio OAuth Secret').role('secret').required(),
        endpoint: Schema.string().description('ThStudio OAuth Endpoint').required(),
        endpointApi: Schema.string().description('ThStudio OAuth API Endpoint').required(),
        canRegister: Schema.boolean().default(true),
    });

    constructor(ctx: Context, config: ReturnType<typeof ThStudioOAuthService.Config>) {
        super(ctx, 'oauth.thstudio');
        ctx.oauth.provide('thstudio', {
            text: 'Login with ThStudio',
            name: 'ThStudio',
            canRegister: config.canRegister,

            // 当用户点击登录按钮时
            get: async function get(this: Handler) {
                const [url, [state]] = await Promise.all([
                    SystemModel.get('server.url'),
                    TokenModel.add(TokenModel.TYPE_OAUTH, 600, { redirect: this.request.referer }),
                ]);
                this.response.redirect = `${config.endpoint}/#/auth/sso-login?response_type=code&client_id=${config.id}&redirect_uri=${url}oauth/thstudio/callback&state=${state}`;
            },

            // 回调处理
            callback: async function callback(this: Handler, { state, code, error }) {
                if (error) throw new UserFacingError(error);

                const [url, s] = await Promise.all([
                    SystemModel.get('server.url'),
                    TokenModel.get(state, TokenModel.TYPE_OAUTH),
                ]);

                // 1. 请求 token
                const tokenApi = `${config.endpointApi}/admin-api/system/oauth2/token?grant_type=authorization_code&code=${code}&state=${state}&redirect_uri=${url}oauth/thstudio/callback`;
                const res = await superagent.post(tokenApi)
                    .set('Authorization', `Basic ${btoa(`${config.id}:${config.secret}`)}`);
                if (res.body.error) {
                    throw new UserFacingError(
                        res.body.error, res.body.error_description, res.body.error_uri,
                    );
                }
                const tokenInfo = res.body.data;
                const token = `${tokenInfo.access_token}`;
                if (tokenInfo.scope.includes('user.read') === false) {
                    throw new ForbiddenError('需要 读取用户信息 权限。');
                }
                console.log(token)
                // 2. 请求用户信息
                const userInfoApi = `${config.endpointApi}/admin-api/system/oauth2/user/get`;
                const userResp = await superagent.get(userInfoApi)
                    .set('Authorization', token);
                const userInfo = userResp.body?.data ?? userResp.body;
                console.log(userInfo);
                const ret = {
                    _id: `${userInfo.id}`,
                    email: userInfo.email,
                    uname: [`${userInfo.nickname}`], // 支持多候选用户名
                    studentId: userInfo.studentId,
                    uid: userInfo.uid,
                    avatar: `url:${userInfo.avatar}`,
                };

                await TokenModel.del(state, TokenModel.TYPE_OAUTH);
                this.response.redirect = s.redirect;

                if (!ret.email) throw new ForbiddenError('您没有经过验证的电子邮件。');
                return ret;
            },
        });

        ctx.i18n.load('zh', {
            'Login with ThStudio': '使用 梯航Studio 登录',
        });
    }
}
