import { CACHE_POLICIES, handleApi } from "@/lib/api/http";
import { openApiSpec } from "@/lib/api/openapi";

export async function GET(req: Request): Promise<Response> {
  return handleApi(req, CACHE_POLICIES.openapi, async () => ({ json: openApiSpec }));
}
