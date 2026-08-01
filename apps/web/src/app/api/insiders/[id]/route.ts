import { eq, insiders } from "@insiderflow/db";

import { ApiError, CACHE_POLICIES, handleApi } from "@/lib/api/http";
import { queryTrades } from "@/lib/api/queries";
import { tradesQuerySchema, uuidParamSchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApi(req, CACHE_POLICIES.insider, async () => {
    const id = uuidParamSchema.parse((await params).id);
    const db = getDb();

    const [insider] = await db.select().from(insiders).where(eq(insiders.id, id));
    if (!insider) throw new ApiError(404, "No insider with that id");

    const trades = await queryTrades(db, {
      ...tradesQuerySchema.parse({}),
      insider_id: id,
      limit: 25,
    });

    return {
      json: {
        data: {
          id: insider.id,
          name: insider.name,
          cik: insider.cik,
          isDirector: insider.isDirector,
          isOfficer: insider.isOfficer,
          isTenPctOwner: insider.isTenPctOwner,
          officerTitle: insider.officerTitle,
          recentTrades: trades.data,
        },
      },
    };
  });
}
