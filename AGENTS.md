<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Goal persistence

When given a task, do not stop working or hand back control until the stated goal is actually met — verify it (compile check, curl the endpoint, check the live output) rather than assuming the change worked. If you hit a blocker that genuinely requires user input (a decision, a credential, a missing account), stop and ask; otherwise keep iterating until the goal is satisfied.
