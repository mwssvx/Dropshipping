import { handlePublicApi } from "@/lib/public-api";

type Params = { params: Promise<{ path: string[] }> };
const handle = async (req: Request, { params }: Params) => handlePublicApi(req, (await params).path);

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
