# Multiline todo intake

Open **新建待办 → 多行录入**. Paste one item per line, then choose **预检条目**. Each preview row can be edited or unchecked. Blank lines, duplicate selected titles and titles above the existing 240-character service limit must be corrected or unchecked. A preview is limited to 50 lines; it does not write records. Original input is retained. Dates remain unset, including words such as “tomorrow” in a title.

**确认顺序保存** uses the existing single-record writer, one selected row at a time, with a separate idempotency key, server receipt and independent detail GET. This is a non-atomic sequence: previously verified rows remain saved when a later row fails. A failure or unknown outcome stops later rows. The preview displays each verified identity and revision.

Refresh restores the draft only after the same owner and space have been verified. An attempted row retains its original command, body and key. Continuing retries that command; previously verified rows are skipped. Session expiry or a failed independent readback preserves the command. **停止等待并保留请求** stops waiting without claiming cancellation on the server. Unknown requests must be resolved before clearing the batch. Closing retains the draft; **清空批次** removes the completed or unattempted local batch. Browser session storage is required.

Agent clients use the existing [`createTodo` / `getTodo` operations](../../skills/lifeos-agent/references/operations.md), with each operation checked against current capability discovery and its existing scopes. Multiline intake adds no bulk endpoint, scope or grant. Agents must apply the same explicit confirmation, sequential non-atomic semantics and unknown-command recovery; the web UI uses the existing owner-session transport.

This page describes generic behavior. Synthetic tests and runtime readback do not establish owner experience acceptance.
