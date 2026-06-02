const FEISHU_APP_ID = process.env.FEISHU_APP_ID || "";
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || "";
const BASE_URL = "https://open.feishu.cn/open-apis";

/**
 * 获取应用 access_token（内部调用用）
 */
export async function getAppAccessToken(): Promise<string> {
  const resp = await fetch(`${BASE_URL}/auth/v3/app_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET,
    }),
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`获取 app_access_token 失败: ${data.msg}`);
  }
  return data.app_access_token;
}

/**
 * 用授权码换取用户 access_token
 */
export async function getUserAccessToken(code: string): Promise<string> {
  // 先拿 app_access_token
  const appToken = await getAppAccessToken();

  // 用 app_access_token + code 换 user_access_token
  const resp = await fetch(`${BASE_URL}/authen/v1/oidc/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${appToken}`,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
    }),
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`获取 user_access_token 失败: code=${data.code}, msg=${data.msg}`);
  }
  return data.data.access_token;
}

/**
 * 获取飞书用户信息（含部门）
 */
export async function getUserInfo(accessToken: string) {
  const resp = await fetch(`${BASE_URL}/authen/v1/user_info`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`获取用户信息失败: code=${data.code}, msg=${data.msg}`);
  }
  return data.data;
}

/**
 * 用 app_access_token 获取用户详细信息（含部门名称）
 * 需要权限: contact:user.base:readonly, contact:user.department_id:readonly
 */
export async function getUserDetail(appToken: string, userId: string) {
  const resp = await fetch(`${BASE_URL}/contact/v3/users/${userId}?user_id_type=open_id&department_id_type=open_department_id`, {
    headers: {
      Authorization: `Bearer ${appToken}`,
    },
  });
  const data = await resp.json();
  if (data.code !== 0) {
    console.error(`[Feishu] 获取用户详情失败: code=${data.code}, msg=${data.msg}`);
    return null;
  }
  return data.data?.user || null;
}

/**
 * 获取部门信息（部门名称）
 * 需要权限: contact:department.base:readonly
 */
export async function getDepartmentInfo(appToken: string, departmentId: string) {
  const resp = await fetch(`${BASE_URL}/contact/v3/departments/${departmentId}?department_id_type=open_department_id`, {
    headers: {
      Authorization: `Bearer ${appToken}`,
    },
  });
  const data = await resp.json();
  if (data.code !== 0) {
    console.error(`[Feishu] 获取部门信息失败: code=${data.code}, msg=${data.msg}`);
    return null;
  }
  return data.data?.department || null;
}
