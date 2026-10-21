# Grill Autopilot

A grill session where one AI asks design questions and another AI answers them on the user's behalf, so the user is only interrupted for an Escalation.

## Language

**Interviewer**:
The AI role that runs grill rounds: it maps the design tree and asks every frontier question with a recommended answer.
_Avoid_: Griller, asker, Agent A

**Proxy**:
The AI role that answers each Interviewer question in place of the user, backed by its own reasoning or evidence rather than echoing the recommendation.
_Avoid_: Answerer, respondent, user proxy, Agent B

**Escalation**:
A question the Proxy may not settle and must hold for the user: side effects (safety, external sends, payment, deletion), facts only the user knows that block later branches, hard-to-reverse choices with weak evidence, or an answer that changed twice.
_Avoid_: Confirmation, checkpoint, ask

**Assumption**:
A taste or preference question the Proxy settled with a repo-consistent default, recorded so the user can overturn it later.
_Avoid_: Guess, default

**Decision Log**:
The session's closing record of every decision, its reason, evidence, and which entries are Assumptions or Escalations.
_Avoid_: Summary, report

**Pairing**:
The choice of which AI product and account plays the Interviewer and which plays the Proxy for one session.
_Avoid_: Combo, setup
