<!-- One task per ticket. The agent never sees this conversation: if it would have to ask,
     the ticket is incomplete. Task text and acceptance criteria inline verbatim;
     everything bulky by path. Contract: ../references/tickets.md -->

TASK:             <one task, in the user's terms>
EXPECTED OUTCOME: <observable definition of done, gradeable before dispatch>
CONTEXT:          <file PATHS to read, current state, background — paths, not pasted content>
CONSTRAINTS:      <stack, patterns, compatibility requirements>
MUST DO:          <non-negotiables, including the exact verify command to run>
MUST NOT:         <the fence — scope off limits; no subagent spawning; no test harness>
OUTPUT FORMAT:    <status-first for execution roles, verdict-first for the verifier;
                  ≤ 25 lines (verifier ≤ 40); end with the literal `git diff --stat <BASE>`
                  and `device touched: no | yes (<file> md5 <hash>)`>
WRITE SET:        <every file or glob this agent may create or modify — mandatory for any
                  writing role, omitted only for read-only roles>
READ FIRST:       <the docs/reference/*.md row for the subsystem, the DESIGN.md sections for
                  UI work, the recon report path — paths, never pasted content>
DEVICE:           <none | read-only | deploy:/tmp | deploy:live (user approved: "<quote>");
                  default none; any other value names the device by its .env prefix>
PROOF:            <the exact command or route that proves the change and what output means
                  done — e.g. scp to /tmp and run as www-data via `sudo -n -u www-data`,
                  curl through lighttpd, or load <route> in the Browser pane>
