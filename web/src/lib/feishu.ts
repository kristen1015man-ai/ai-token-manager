const FEISHU_APP_ID = process.env.FEISHU_APP_ID || "";
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || "";
const BASE_URL = "https://open.feishu.cn/open-apis";

// 启动时校验：生产环境必须配置飞书应用凭证
if (process.env.NODE_ENV === "production" && (!FEISHU_APP_ID || !FEISHU_APP_SECRET)) {
  throw new Error("[FATAL] FEISHU_APP_ID 和 FEISHU_APP_SECRET 必须在生产环境中配置。");
}

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

/**
 * 获取部门详细信息（含父级关系、负责人）
 * 需要权限: contact:department.base:readonly
 */
export async function getDepartmentDetail(appToken: string, departmentId: string) {
  const resp = await fetch(
    `${BASE_URL}/contact/v3/departments/${departmentId}?department_id_type=open_department_id`,
    { headers: { Authorization: `Bearer ${appToken}` } }
  );
  const data = await resp.json();
  if (data.code !== 0) {
    console.error(`[Feishu] 获取部门详情失败: code=${data.code}, msg=${data.msg}`);
    return null;
  }
  return data.data?.department || null;
}

/**
 * 递归获取所有部门（含父级关系）
 * 返回完整树结构
 */
export async function fetchAllDepartmentsWithParent(appToken: string) {
  const allDepts: Array<{
    department_id: string;
    name: string;
    parent_department_id: string;
    leader_user_id?: string;
  }> = [];

  async function fetchSubDepts(parentId: string, depth: number) {
    const resp = await fetch(
      `${BASE_URL}/contact/v3/departments?parent_department_id=${parentId}&department_id_type=department_id&fetch_child=false&page_size=50`,
      { headers: { Authorization: `Bearer ${appToken}` } }
    );
    const data = await resp.json();
    if (data.code !== 0) {
      console.log(`[Feishu] 获取子部门失败 (parent=${parentId}): code=${data.code}, msg=${data.msg}`);
      return;
    }
    const items = data.data?.items || [];
    for (const dept of items) {
      const deptId = dept.department_id || dept.id || "";
      allDepts.push({
        department_id: deptId,
        name: dept.name,
        parent_department_id: dept.parent_department_id || parentId,
        leader_user_id: dept.leader_user_id || undefined,
      });
      if (depth < 6) {
        await fetchSubDepts(deptId, depth + 1);
      }
    }
  }

  await fetchSubDepts("0", 0);
  return allDepts;
}

/**
 * 获取用户所属的所有部门 ID 列表
 * 需要权限: contact:user.base:readonly
 */
export async function getUserDepartmentIds(appToken: string, openId: string): Promise<string[]> {
  try {
    const resp = await fetch(
      `${BASE_URL}/contact/v3/users/${openId}?user_id_type=open_id&department_id_type=department_id`,
      { headers: { Authorization: `Bearer ${appToken}` } }
    );
    const data = await resp.json();
    if (data.code !== 0) return [];
    const user = data.data?.user;
    return user?.department_ids || [];
  } catch (err) {
    console.warn("[Feishu] 获取用户部门列表失败:", err);
    return [];
  }
}
