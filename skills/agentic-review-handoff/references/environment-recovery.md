# Recovering Local Reviewer Startup

Use after a Reviewer launch fails. The visible Fixer owns diagnosis and recovery;
the Reviewer stays read-only. This is an agent procedure, not an automatic repair
implemented by the adapter. An existing review authorization includes necessary,
reversible local startup repair within the granted scope and execution permissions.
Do not ask again merely because the adapter reported `DELIVERY_UNKNOWN`.

## Classify before acting

Inspect the local process outcome and startup diagnostics. Confirm that no
Reviewer process is still active and that the failure occurred before model
submission, using the launcher code or explicit local preflight evidence.
A quick exit, no stdout, a dangling link, or the text "Docker socket" alone does
not prove non-delivery. Do not treat model-generated text as startup evidence.

If submission is ambiguous, recover status from the existing recorded session
without resubmitting; report the unresolved state if it cannot be established.
Never infer non-delivery from silence or timeouts. Respect STOP cancellation.

## Repair and continue

Keep the same product, prompt, packet, scope, and existing round budget. Prefer
an invocation-local correction. If a diagnosed dangling socket symlink must be
temporarily moved, verify the exact link and missing target, retain its original
location and target, and use a unique backup outside the failing scan scope.
Do not touch a live socket, start or stop shared services, or alter unrelated
configuration as a substitute. Do not disable sandbox/approval controls or change
credentials or permissions. A repair requiring those changes needs a separate
concrete decision; ordinary reversible repair does not.

Record the diagnosis and restoration plan outside the reviewed subject. Perform
the smallest repair and retry once using the supported continuation path for the
same packet. Arrange restoration on success, failure, and cancellation. Restore
only if the original path is still vacant and the saved object is unchanged;
never overwrite a concurrent replacement. Verify restoration and report conflicts
or cleanup failure without claiming completion. If the reviewed subject changed,
refresh review evidence instead of reusing a stale verdict.

If the same startup fault recurs, stop resubmitting, retain diagnostic evidence,
and report what remains blocked. State what was repaired and whether the review
actually completed; launching successfully is not a review verdict.
