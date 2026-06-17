export async function POST() {
  return Response.json({
    error: {
      message: "Use the Hono proxy service /v1/chat/completions endpoint.",
      type: "disabled_web_proxy",
    },
  }, { status: 410 });
}
