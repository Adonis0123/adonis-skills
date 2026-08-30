# Runtime measurement playbook

Select tests that can falsify a hypothesis. Do not run every test mechanically.

## First-principles user costs

An interactive page can feel slow because of:

| Cost                   | User symptom                          | Useful signals                                                                    |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| Input queueing         | click/key feels ignored               | Event Timing input delay, main-thread occupancy, long tasks                       |
| Handler/framework work | control responds late                 | event duration, call tree, React commits, source marks                            |
| Style/layout/paint     | visual update arrives late or jitters | trace rendering tracks, layout shifts, screenshots/video                          |
| Media decode/composite | playback stutters or preview flashes  | media state, frame cadence, decode/GPU clues, negative pause control              |
| Network/cache/query    | cold open or switching waits          | request waterfall, transfer/cache, request initiator, cold/warm comparison        |
| Memory/GC              | session degrades over time            | heap snapshots/deltas across GC, nodes/listeners, media surfaces, repeated cycles |
| Background/third party | unrelated work steals budget          | domain/request inventory, task attribution, tracker on/off comparison             |

## Stable run protocol

For comparable runs, hold constant:

- URL, dataset/project/chapter, user role, selected item, and media timestamp;
- viewport, DPR, browser version/profile, build mode, cache mode, and extension state;
- start/end state and wait conditions;
- action order and number of repetitions.

Use a short idle window before and after the action. Record failed or timed-out runs, but discard them from product aggregates.

Define “cold” before collecting it. Record which layers are reset: new page lifecycle, HTTP cache, service worker/cache storage, application/query store, media timestamp, and browser profile. Reloading with a warm service worker is not the same cold state as a fresh isolated profile; do not pool them.

For important comparisons, prefer at least three repetitions. Report median and range when possible. Do not imply statistical confidence from three samples; the repetitions only expose gross instability.

## Coverage sequence for tabbed applications

1. Capture initial page and tab tree.
2. Open every primary tab once; record cold shell and content-ready behavior.
3. Exercise each nested tab/mode/filter once.
4. Return to each primary tab; record warm behavior and state preservation.
5. Run representative rapid cycles, not every pairwise permutation.
6. Repeat the highest-risk switches during playback/animation.
7. Repeat one risk path under CPU throttle.
8. Run long-list scroll and one resize sweep.
9. Wait for recovery; compare DOM nodes, listeners, resources, and heap with the baseline.

For destructive or expensive tabs such as export, publish, generation, payment, or delete, inspect up to the confirmation boundary unless the user explicitly authorizes the action.

## Measurement semantics and caveats

### Event Timing and INP

- A lab `PerformanceEventTiming.duration` describes the observed interaction entry under that run's conditions.
- INP is a field/lifecycle metric with interaction grouping and percentile semantics. A single local click is not INP.
- Automation elapsed time can include tool round trips and should not replace browser Event Timing.
- A `PerformanceObserver` fallback must request the lowest supported `durationThreshold` (normally 16ms), start before the action, retain `interactionId`, and record buffer/overflow limitations. Browser defaults can omit faster events, and exposed duration is coarsened; “no entry” is not “no delay.”

### Main-thread windows and long tasks

- `TaskDuration` or trace task time across a window includes background scripts, timers, tracking, DevTools, and other activity.
- A task longer than 50ms is a Long Task signal, not proof of which user action caused it.
- Subtracting two overlapping noisy windows is not causal attribution. Use trace initiators, marks, or a negative control.

### Images and media surfaces

A limited **nominal RGBA8 proxy** is:

```text
resourcePixelWidth × resourcePixelHeight × 4 bytes
```

Use it only when the actual resource/bitmap pixel dimensions are known. `naturalWidth` and `naturalHeight` can be density-corrected CSS pixels, so responsive 2x/3x candidates may make that formula undercount. Record `currentSrc`, `srcset`, `sizes`, and resource metadata before comparing resource pixels with `displayWidth × displayHeight × DPR²`.

The proxy assumes RGBA8 and is not an upper bound, JS heap, transfer size, decoded-memory measurement, or guaranteed GPU residency. Report mounted, loaded, decoded, and resident as four separate states; only the states directly observed by the current tool may be claimed.

For video, network bytes, decoded frames, compositor surfaces, and decoder queues are different resources. Use pause/seek/visibility controls and trace media tracks when available.

### Memory and leaks

- A heap increase before natural or forced GC is allocation, not a leak.
- One post-GC snapshot is not a trend.
- Stronger evidence is monotonic retained growth across repeated equivalent cycles after recovery/GC, supported by retainers, nodes/listeners, or media resources.
- If memory tooling is unavailable, say `UNVERIFIED`; do not convert image estimates into a leak claim.

### Layout shift and resizing

- Shifts caused by manually changing viewport size do not represent ordinary user-session CLS.
- User-input-related shifts can be excluded from CLS depending on timing; preserve the trace attribution.
- Visual jitter without LayoutShift entries can still matter, but label it `SCREEN_OBSERVED` and capture video/screenshots.

### Coverage and bundles

- Development source text and precise function Coverage do not equal production compressed transfer, parse, compile, or execution cost.
- Coverage during a short flow only proves “not executed in this window,” not “dead code.”
- Use production build/chunk analysis before recommending code splitting based on dev Coverage.

### React instrumentation

- React commit/render duration covers React work, not total interaction latency.
- Component render counts can identify churn but not user impact without a browser-level signal.
- React Scan, React Profiler, extension overlays, and DevTools attachment can change scheduling. Compare with instrumentation off.
- Record React, React Scan/Profiler, and build versions. Development StrictMode may intentionally double-invoke work; a production build without profiling hooks can report zero or unavailable durations. Verify hook readiness, reload requirements, and identical profile/dataset state before treating `0ms` as “no React cost.”

### Network and tracking

- Request count, transfer bytes, main-thread listener cost, and privacy impact are different dimensions.
- A cached beacon can have low transfer but still prove repeated instrumentation.
- Development tracker configuration does not prove production behavior. Verify the target build.

## Suggested bounded matrices

### Complex editor

- paused idle baseline;
- 10–15 seconds playback baseline;
- every top-level tab cold and warm;
- highest-risk tab switch during playback;
- 4× CPU slowdown replay of that switch;
- large-list scroll;
- 10 cycles plus recovery;
- Recorder replay and one React-localization run, each isolated.

### Dashboard

- cold and warm route load;
- each primary tab/filter with normal data;
- largest table/chart state;
- filter input and sort interaction;
- background polling idle window;
- 10 tab/filter cycles plus recovery;
- mobile or constrained CPU if in scope.

### Public landing page

Use a load/Core Web Vitals workflow first. This skill adds value only when runtime interactions, animation, long-lived state, or authenticated behavior are also in scope.

## Stop conditions

Stop investigating or refactoring a direction when:

- the symptom does not reproduce under the intended build and data;
- improvement is smaller than run-to-run variation;
- the signal appears only with the diagnostic tool enabled;
- the page is already responsive and no material long task, frame, memory, or media issue remains;
- a proposed change worsens correctness, state restoration, first-use delay, scrolling, or media quality;
- stronger evidence requires a destructive action or external authorization not in scope.
