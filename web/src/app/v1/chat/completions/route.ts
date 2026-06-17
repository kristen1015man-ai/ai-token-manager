export async function POST() {
  return Response.json({
    error: {
      message: "The Docker production /v1 endpoint is served by the Hono proxy service.",
      type: "disabled_web_proxy",
    },
  }, { status: 410 });
}
