import { NextRequest, NextResponse } from "next/server";
import { getUserAccessToken, getUserInfo, getUserDetail, getDepartmentInfo, getAppAccessToken } from "../../../../../lib/feishu";
import { findOrCreateUser } from "../../../../../lib/user-service";
import { createSession } from "../../../../../lib/auth";

/**
 * 根据部门名称简单分类
 * 登录场景不做完整树分析，只按名称规律判断
 */
function classifyDeptByName(name: string): "center" | "department" | "group" {
  if (name.endsWith("中心")) return "center";
  if (name.endsWith("组")) return "group";
  if (name.endsWith("部")) return "department";
  return "department"; // 默认部门级
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    const host = request.headers.get("host") || "ai.seapllo.com";
    const protocol = request.headers.get("x-forwarded-proto") || "https";
    return NextResponse.redirect(new URL("/login?error=no_code", `${protocol}://${host}`));
  }

  try {
    // 1. 用 code 换 access_token
    const accessToken = await getUserAccessToken(code);
    if (!accessToken) {
      throw new Error("No access token returned from Feishu");
    }

    // 2. 获取用户基本信息
    const userInfo = await getUserInfo(accessToken);
    if (!userInfo) {
      throw new Error("No user info returned from Feishu");
    }

    console.log("[Feishu OAuth] user info:", JSON.stringify(userInfo));

    // 3. 获取所有部门并分类三层
    let departmentName: string | undefined;
    let departmentId: string | undefined;
    let groupName: string | undefined;
    let groupId: string | undefined;
    let centerName: string | undefined;
    let centerId: string | undefined;

    try {
      const appToken = await getAppAccessToken();
      const userDetail = await getUserDetail(appToken, userInfo.open_id);

      if (userDetail) {
        const deptIds: string[] = userDetail.department_ids || [];
        const classified = { center: [] as string[], department: [] as string[], group: [] as string[] };
        const deptNames = new Map<string, string>();

        // 获取所有部门名称并分类
        for (const did of deptIds) {
          try {
            const deptInfo = await getDepartmentInfo(appToken, did);
            if (deptInfo?.name) {
              deptNames.set(did, deptInfo.name);
              const level = classifyDeptByName(deptInfo.name);
              classified[level].push(did);
            }
          } catch {
            // 跳过获取失败的部门
          }
        }

        console.log(`[Feishu OAuth] 部门分类: 中心=${classified.center.length}, 部门=${classified.department.length}, 组=${classified.group.length}`);

        // 取每个层级的第一个
        if (classified.center[0]) {
          centerId = classified.center[0];
          centerName = deptNames.get(centerId);
        }
        if (classified.department[0]) {
          departmentId = classified.department[0];
          departmentName = deptNames.get(departmentId);
        }
        if (classified.group[0]) {
          groupId = classified.group[0];
          groupName = deptNames.get(groupId);
        }

        // 如果没有部门级，尝试从组级或中心推导
        if (!departmentName) {
          if (groupName) {
            // 组挂在部门下，暂时用组名中的部门名
            departmentName = groupName.replace(/[一二三四五六七八九十组]/g, "").replace(/组$/, "部");
            console.log(`[Feishu OAuth] 从组推导部门: ${groupName} → ${departmentName}`);
          } else if (centerName) {
            departmentName = `${centerName}-直属`;
            console.log(`[Feishu OAuth] 无部门级，标记为: ${departmentName}`);
          }
        }
      }
    } catch (deptErr) {
      console.log("[Feishu OAuth] 部门信息获取跳过:", deptErr instanceof Error ? deptErr.message : "");
    }

    // 4. 创建或更新用户
    const user = await findOrCreateUser({
      open_id: userInfo.open_id ?? "",
      name: userInfo.name ?? undefined,
      avatar_url: userInfo.avatar_url ?? undefined,
      email: userInfo.email ?? undefined,
      employee_no: userInfo.employee_no ?? undefined,
      department_id: departmentId,
      department_name: departmentName,
      group_id: groupId,
      group_name: groupName,
      center_id: centerId,
      center_name: centerName,
    });

    if (!user) {
      throw new Error("Failed to create user");
    }

    // 5. 创建 session
    await createSession({
      userId: user.id,
      feishuId: user.feishuId,
      name: user.name,
      role: user.role,
    });

    // 6. 重定向到仪表盘
    const host = request.headers.get("host") || "ai.seapllo.com";
    const protocol = request.headers.get("x-forwarded-proto") || "https";
    return NextResponse.redirect(new URL("/dashboard", `${protocol}://${host}`));
  } catch (error) {
    console.error("Feishu OAuth callback error:", error);
    const host = request.headers.get("host") || "ai.seapllo.com";
    const protocol = request.headers.get("x-forwarded-proto") || "https";
    return NextResponse.redirect(
      new URL(`/login?error=auth_failed&detail=${encodeURIComponent(error instanceof Error ? error.message : "unknown")}`, `${protocol}://${host}`)
    );
  }
}
