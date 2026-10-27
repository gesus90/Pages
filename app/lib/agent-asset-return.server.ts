import type { McpApplicationServices } from "./mcp-services.server";
import type { AgentAsset } from "@/definition/PagesAgentWrites";

/** Connects the runner's binary channel to the exact upload services used by the HTTP endpoint. */
export function runnerAssetUpload(
  services: () => Promise<
    Pick<
      McpApplicationServices,
      | "agentUploadTicketService"
      | "agentTicketUploadService"
      | "agentAssetService"
    >
  >,
): (ticket: string, bytes: Buffer) => Promise<AgentAsset> {
  return async (ticket, bytes) => {
    const current = await services();
    const authority = await current.agentUploadTicketService.consume(ticket);
    const file = {
      fileName: authority.fileName,
      contentLength: bytes.length,
      body: (async function* () {
        yield bytes;
      })(),
    };
    if (authority.pageId && authority.request)
      return current.agentTicketUploadService.uploadWiki(
        file,
        authority.revalidate,
        authority.pageId,
        authority.request,
      );
    return authority.ticketId
      ? current.agentTicketUploadService.upload(
          file,
          authority.revalidate,
          authority.ticketId,
          authority.request,
        )
      : current.agentAssetService.upload(file, authority.revalidate);
  };
}
