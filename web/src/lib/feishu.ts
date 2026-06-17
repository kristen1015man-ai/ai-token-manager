const FEISHU_APP_ID = process.env.FEISHU_APP_ID || "";
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || "";
const BASE_URL = "https://open.feishu.cn/open-apis";

const isNextBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
if (process.env.NODE_ENV === "production" && !isNextBuildPhase && (!FEISHU_APP_ID || !FEISHU_APP_SECRET)) {
  throw new Error("[FATAL] FEISHU_APP_ID and FEISHU_APP_SECRET must be configured in production.");
}

async function readJsonResponse(resp: Response, context: string) {
  if (!resp.ok) {
    throw new Error(`${context}: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`${context}: code=${data.code}, msg=${data.msg || data.message || ""}`);
  }
  return data;
}

export async function getAppAccessToken(): Promise<string> {
  const resp = await fetch(`${BASE_URL}/auth/v3/app_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET,
    }),
  });
  const data = await readJsonResponse(resp, "Get app_access_token failed");
  return data.app_access_token;
}

export async function getUserAccessToken(code: string): Promise<string> {
  const appToken = await getAppAccessToken();
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
  const data = await readJsonResponse(resp, "Get user_access_token failed");
  return data.data.access_token;
}

export async function getUserInfo(accessToken: string) {
  const resp = await fetch(`${BASE_URL}/authen/v1/user_info`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await readJsonResponse(resp, "Get user info failed");
  return data.data;
}

export async function getUserDetail(appToken: string, userId: string) {
  const resp = await fetch(
    `${BASE_URL}/contact/v3/users/${userId}?user_id_type=open_id&department_id_type=open_department_id`,
    { headers: { Authorization: `Bearer ${appToken}` } }
  );
  try {
    const data = await readJsonResponse(resp, `Get user detail failed: ${userId}`);
    return data.data?.user || null;
  } catch (err) {
    console.error("[Feishu]", err);
    return null;
  }
}

export async function getDepartmentInfo(appToken: string, departmentId: string) {
  const resp = await fetch(
    `${BASE_URL}/contact/v3/departments/${departmentId}?department_id_type=open_department_id`,
    { headers: { Authorization: `Bearer ${appToken}` } }
  );
  try {
    const data = await readJsonResponse(resp, `Get department info failed: ${departmentId}`);
    return data.data?.department || null;
  } catch (err) {
    console.error("[Feishu]", err);
    return null;
  }
}

export async function getDepartmentDetail(appToken: string, departmentId: string) {
  return getDepartmentInfo(appToken, departmentId);
}

export async function fetchAllDepartmentsWithParent(appToken: string) {
  const allDepts: Array<{
    department_id: string;
    name: string;
    parent_department_id: string;
    leader_user_id?: string;
  }> = [];

  async function fetchSubDepts(parentId: string, depth: number) {
    let pageToken = "";
    let pageCount = 0;
    do {
      const resp = await fetch(
        `${BASE_URL}/contact/v3/departments?parent_department_id=${parentId}&department_id_type=department_id&fetch_child=false&page_size=50${pageToken ? `&page_token=${pageToken}` : ""}`,
        { headers: { Authorization: `Bearer ${appToken}` } }
      );
      const data = await readJsonResponse(resp, `Fetch departments failed: parent=${parentId}`);

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

      pageToken = data.data?.has_more ? data.data?.page_token : "";
      pageCount += 1;
      if (pageCount > 200) {
        throw new Error(`Fetch departments exceeded pagination guard: parent=${parentId}`);
      }
    } while (pageToken);
  }

  await fetchSubDepts("0", 0);
  return allDepts;
}

export async function getUserDepartmentIds(appToken: string, openId: string): Promise<string[]> {
  try {
    const resp = await fetch(
      `${BASE_URL}/contact/v3/users/${openId}?user_id_type=open_id&department_id_type=department_id`,
      { headers: { Authorization: `Bearer ${appToken}` } }
    );
    const data = await readJsonResponse(resp, `Get user department ids failed: ${openId}`);
    const user = data.data?.user;
    return user?.department_ids || [];
  } catch (err) {
    console.warn("[Feishu] Get user department ids failed:", err);
    return [];
  }
}
