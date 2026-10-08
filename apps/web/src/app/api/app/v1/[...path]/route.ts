import { handleAppRequest } from "@/lib/app-api";

type Params = { params: Promise<{ path: string[] }> };
const handle = async (req: Request, { params }: Params) => handleAppRequest(req, (await params).path);

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS };
