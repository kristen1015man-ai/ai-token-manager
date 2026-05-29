import * as lark from "@larksuiteoapi/node-sdk";

const FEISHU_APP_ID = process.env.FEISHU_APP_ID || "";
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || "";

// 飞书客户端
const client = new lark.Client({
  appId: FEISHU_APP_ID,
  appSecret: FEISHU_APP_SECRET,
});

/**
 * 用授权码换取用户 access_token
 */
export async function getUserAccessToken(code: string) {
  const resp = await client.authen.v1.accessToken.create({
    data: {
      grant_type: "authorization_code",
      code,
    },
  });

  if (resp.code !== 0) {
    throw new Error(`Failed to get access token: ${resp.msg}`);
  }

  return resp.data;
}

/**
 * 获取飞书用户信息
 */
export async function getUserInfo(accessToken: string) {
  const resp = await client.authen.v1.userInfo.get({
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (resp.code !== 0) {
    throw new Error(`Failed to get user info: ${resp.msg}`);
  }

  return resp.data;
}

export { client };
