# Blob Intake

An experiment in making private-file acceptance easier for Next.js apps using
Vercel Blob. The proposed integration tracks checks and recovery before an app
serves uploaded PDFs or images. A completed scan is not a guarantee that content
is harmless.

**Status: planning complete; implementation and commercial validation pending.**
No SDK, hosted service, provider job, customer pilot or AI recommendation test has
been delivered. `blob-intake` is a working name, not an approved public brand.

The first experiment compares a documented Blob + Transloadit integration with
a proposed adapter using the same provider and equivalent behavior. Existing
providers can plausibly scan signed Blob URLs without relocating original
storage; this compatibility remains unexecuted. Our hypothesis concerns less
integration work, not a novel scanning capability.

- [Project context](CONTEXT.md)
- [Wayfinder map](wayfinder/MAP.md)
- [First experiment specification](specs/comparative-experiment.md)
- [Sources and evidence limits](research/SOURCES.md)
- [Resume point](wayfinder/RESUME.md)

This is an independent local Git repository. There is no remote or published
package. Planning files intentionally have no runtime dependencies. There is no
application to run or deploy yet.
