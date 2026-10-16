import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { listFiles } from "@/server/handlers/files";
import { formatBytes } from "@/lib/utils";
import { Uploader } from "./uploader";

export const metadata = { title: "Files" };

const TONE = { CLEAN: "success", PENDING: "warning", INFECTED: "danger" } as const;
const LABEL = { CLEAN: "Clean", PENDING: "Scanning", INFECTED: "Blocked" } as const;

export default async function FilesPage() {
  const { ctx } = await requireFirmPage();
  const files = await listFiles(deps(), ctx);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
        <p className="text-sm text-muted-foreground">Every upload is virus-scanned before anyone can open it.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload</CardTitle>
          <CardDescription>PDF, PNG, JPEG, WebP or HEIC, up to 15 MB.</CardDescription>
        </CardHeader>
        <CardContent>
          <Uploader />
        </CardContent>
      </Card>
      <Card>
        <Table data-testid="files-table">
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Size</TH>
              <TH>Scan</TH>
              <TH>Uploaded</TH>
            </TR>
          </THead>
          <TBody>
            {files.length === 0 && (
              <TR>
                <TD colSpan={4} className="py-8 text-center text-muted-foreground">
                  No files yet.
                </TD>
              </TR>
            )}
            {files.map((f) => (
              <TR key={f.id} data-file-id={f.id}>
                <TD className="max-w-[18rem] truncate">
                  {f.scanStatus === "CLEAN" ? (
                    <a className="text-primary hover:underline" href={`/api/files/${f.id}/download`}>
                      {f.filename}
                    </a>
                  ) : (
                    f.filename
                  )}
                </TD>
                <TD className="text-muted-foreground">{formatBytes(f.sizeBytes)}</TD>
                <TD>
                  <Badge tone={TONE[f.scanStatus]} data-testid="scan-status">
                    {LABEL[f.scanStatus]}
                  </Badge>
                </TD>
                <TD className="text-muted-foreground">{f.createdAt.toLocaleString("en-US", { timeZone: "America/Chicago" })}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
