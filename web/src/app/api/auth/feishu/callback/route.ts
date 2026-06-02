import { NextRequest, NextResponse } from "next/server";
import { getUserAccessToken, getUserInfo, getUserDetail, getDepartmentInfo, getAppAccessToken } from "../../../../../lib/feishu";
import { findOrCreateUser } from "../../../../../lib/user-service";
import { createSession } from "../../../../../lib/auth";

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

    // 3. 尝试获取部门信息（需要额外权限，如果没开通就跳过）
    let departmentName: string | undefined;
    let departmentId: string | undefined;

    try {
      const appToken = await getAppAccessToken();
      const userDetail = await getUserDetail(appToken, userInfo.open_id);

      if (userDetail) {
        // 从用户详情中提取部门 ID
        const deptIds: string[] = userDetail.department_ids || [];
        if (deptIds.length > 0) {
          departmentId = deptIds[0]; // 取第一个部门（主部门）
          // 获取部门名称
          const deptInfo = await getDepartmentInfo(appToken, departmentId);
          if (deptInfo) {
            departmentName = deptInfo.name;
            console.log(`[Feishu OAuth] 部门: ${departmentName} (${departmentId})`);
          }
        }
      }
    } catch (deptErr) {
      // 部门权限未开启，不影响登录
      console.log("[Feishu OAuth] 部门信息获取跳过（可能权限未开启）:", deptErr instanceof Error ? deptErr.message : "");
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
