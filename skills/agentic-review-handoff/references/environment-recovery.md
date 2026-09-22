# Reviewer Startup Failures

Keep review work separate from host maintenance. Capture the launcher error and
report the unavailable reviewer once. Do not move/delete Docker sockets, start
services, change account configuration, or ask the user to do those things as a
routine review step. Host repair is a separate task.

For a failure explicitly diagnosed before model submission, correct only an
invocation-local mistake within existing authorization, then retry once. Preserve
the selected account, scope, controls, and budget. Do not infer non-delivery from
silence, a quick exit, or model-generated text. Never retry an ambiguous submission
or timeout; inspect the existing session. Respect STOP cancellation.

Optional advisory consult: continue independent work and report the missing peer
opinion. Required review: report blocked/UNVERIFIED. Never invent a verdict or
silently substitute an account/product. Repeated failure ends the attempt.
