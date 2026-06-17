import "hono";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userName: string;
    userRole: string;
  }
}
