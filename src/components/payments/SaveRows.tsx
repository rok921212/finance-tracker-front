import React from "react";
import { Link } from "react-router-dom";
import { dismissSave, EntrySave, retrySave } from "../../lib/pendingSaves";

const actionClass = "text-yellow-300 hover:underline";

/** Entries saved in the background, each with its state and what can be done about it. */
const SaveRows: React.FC<{ saves: EntrySave[] }> = ({ saves }) => (
  <ul className="divide-y divide-gray-800 text-sm">
    {saves.map((s) => (
      <li key={s.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <span className="text-gray-200">
          <span className="font-medium">{s.player}</span>
          <span className="text-gray-400">
            {" "}
            · ${s.deposit} · {s.game} · {s.gameUsername}
          </span>
          {s.status === "failed" && <span className="block text-xs text-red-300">{s.error}</span>}
        </span>
        <span className="flex items-center gap-3 text-xs text-gray-500">
          {s.status === "saving" && "Saving…"}
          {s.status === "saved" && (
            <>
              {s.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              <Link className={actionClass} to={`/payments/${s.id}/edit`}>
                Edit
              </Link>
            </>
          )}
          {s.status === "failed" && (
            <>
              <button type="button" className={actionClass} onClick={() => retrySave(s.key, s.duplicate)}>
                {s.duplicate ? "Use anyway" : "Retry"}
              </button>
              <button type="button" className="text-gray-400 hover:underline" onClick={() => dismissSave(s.key)}>
                Discard
              </button>
            </>
          )}
        </span>
      </li>
    ))}
  </ul>
);

export default SaveRows;
