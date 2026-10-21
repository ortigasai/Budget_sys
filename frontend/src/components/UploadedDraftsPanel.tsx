import { Link } from "react-router-dom";

export interface UploadedDraft {
  id: string;
  ticketNumber: string;
  title: string;
  amount: number;
}

// The drafts a template upload just saved (routes/bulkUpload.ts), listed on
// the upload page itself. The Department Head / Approver is picked once for
// all of them in My Requests (multi-select), where they're submitted.
export function UploadedDraftsPanel({ drafts, onClear }: { drafts: UploadedDraft[]; onClear: () => void }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium text-emerald-900">Uploaded drafts ({drafts.length})</span>
        <span className="text-xs text-slate-500">Saved as Draft. In My Requests, select them, pick the Department Head / Approver once and submit.</span>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/requests/mine" className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600">
            Go to My Requests
          </Link>
          <button type="button" onClick={onClear} className="text-xs text-slate-500 hover:text-slate-700">
            Close
          </button>
        </div>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1 pr-2 font-medium">Ticket #</th>
            <th className="py-1 pr-2 font-medium">Item</th>
            <th className="py-1 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((d) => (
            <tr key={d.id} className="border-t border-emerald-100 align-top">
              <td className="py-1 pr-2">
                <Link to={`/requests/${d.id}`} className="text-emerald-800 hover:underline">
                  {d.ticketNumber}
                </Link>
              </td>
              <td className="py-1 pr-2">{d.title}</td>
              <td className="py-1 text-right">{d.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
