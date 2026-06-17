export async function GET() {
  return Response.json({
    error: {
      message: "Use the Hono proxy service /v1/models endpoint.",
      type: "disabled_web_proxy",
    },
  }, { status: 410 });
}
