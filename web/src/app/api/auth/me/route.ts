import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { findUserById } from "../../../../lib/user-service";

export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserById(session.userId);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      role: user.role,
      department: user.department,
      email: user.email,
    },
  });
}
