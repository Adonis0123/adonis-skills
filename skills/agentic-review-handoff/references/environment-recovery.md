# Reviewer Startup Failures

Keep review work separate from host maintenance. Capture the launcher error and
report the unavailable reviewer once. Do not move/delete Docker sockets, start
services, change account configuration, or ask the user to do those things as a
routine review step. Host repair is a separate task.

For a failure explicitly diagnosed before model submission, correct only an
invocation-local mistake within existing authorization, then retry once. Preserve
the selected account, scope, controls, and budget. Do not infer non-delivery from
silence, a quick exit, or model-generated text. Never resubmit an ambiguous
submission or timeout to the same product. Only the run/consult script may
advance to the next configured fallback product after `timedOut: true`, recording
each switch. This does not prove non-delivery of the timed-out invocation.
Non-timeout failures and timeouts without a remaining fallback stay
`DELIVERY_UNKNOWN`; inspect the existing session. Respect STOP cancellation.

Optional advisory consult: continue independent work and report the missing peer
opinion. Required review: report blocked/UNVERIFIED. Never invent a verdict or
silently substitute an account/product. Report configured fallback switches.
Failure after fallback is unavailable or exhausted ends the attempt.
