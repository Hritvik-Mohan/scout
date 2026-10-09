# Hritvik Mohan - Job-search ICP

## Positioning

**Backend and distributed-systems engineer with 3+ years of hands-on software
experience, currently an SDE 1, who has owned core simulation infrastructure,
reliability mechanisms, observability, performance work, cloud delivery, and
technical design.**

The strongest evidence is unusually deep for a typical SDE 1 profile: 150+
merged PRs and 500+ commits as the primary engineer on a distributed-systems
simulator; routing and load-balancing algorithms; fault and availability
modeling; metrics and tracing; C++ and shared-memory performance work;
multi-pass schema validation; 200+ technical specs and ADRs; and AWS, Docker,
and CI/CD delivery.

This makes **SDE 1 roles a safe fit and SDE 2 roles a credible growth or
direct-fit target**, especially at companies that evaluate ownership and systems
depth rather than relying only on years in an SDE title.

This ICP is version 1, derived from the current resume. It is designed to evolve
as new work, projects, outcomes, and preferences are added.

The search is explicitly **Bengaluru-first plus remote worldwide**. Bengaluru
roles may be on-site, hybrid, or remote. Roles based elsewhere qualify only when
the employer can legally engage someone working remotely from India and the
required working hours are sustainable.

## Resume facts (October 2026 resume)

These are the facts recruiters will check. Application drafts and reviews must
stay inside them.

- **Timeline:** Software Development Engineer (SDE 1) at Newton School,
  Bengaluru, since March 2025. Technical Program Manager at Newton School from
  March 2023 to March 2025, with hands-on building in that role. One month as a
  volunteer full-stack developer in early 2022.
- **What "3+ years" means:** 3+ years of hands-on experience across those roles.
  The SDE title covers the period since March 2025, so postings with a firm "3+
  years as a software engineer" requirement are a stretch on title tenure, while
  0-2 and 1-3 year bands are a direct fit.
- **The simulator:** an Electron and TypeScript desktop simulator for
  distributed systems and microservice architectures. Routing, load balancing,
  failure modes, rate limiting, queueing, and million-RPS scenarios are modeled
  and verified in the simulator. Do not present them as operating a production
  service at that scale.
- **Production operations:** Dockerized AWS services made fault-tolerant with
  health checks and restart policies; CI/CD with Docker, NGINX, GitHub Actions,
  and AWS (EC2, ECR, CodeBuild).
- **Team leadership:** led architecture and development of a data aggregation
  platform with IIT Roorkee, managing a distributed team of 6 (Next.js, Django,
  Puppeteer, Docker, AWS). This is separate from the simulator.
- **TPM-era work:** built NS Trinity (React Native app with a Django REST
  Framework API); code reviewer on two projects; ran 76 technical interviews;
  created 200+ JavaScript and React coding problems with Cypress end-to-end
  tests.
- **Projects:** DeckBattle Arena (real-time multiplayer engine on Node.js,
  TypeScript, Socket.io, Express, MongoDB); Auction App (Express, EJS).
- **Languages listed:** TypeScript, JavaScript, Node.js, Java, C++, SQL. C++ is
  evidenced by the native-addon priority queue. Java has no supporting bullet,
  and Python is used through Django but is not listed. Go, Kubernetes, and
  Terraform do not appear.
- **Education:** BCA (2019-2022), Mahatma Gandhi Kashi Vidyapith University,
  Varanasi. MCA (online, 2025-2027, in progress), Vellore Institute of
  Technology.

## Target roles

### Tier 1 - strongest fit

- Software Development Engineer (SDE 1 / SDE 2)
- Software Engineer I / II
- Backend Engineer / Backend Software Engineer
- Distributed Systems Engineer at junior-to-mid scope
- Platform Engineer / Infrastructure Software Engineer
- TypeScript or Node.js Engineer

### Tier 2 - strong adjacent fit

- Product Engineer with substantial backend ownership
- Full-stack Engineer where backend and systems work is at least half the role
- Developer Tools or Developer Productivity Engineer
- Performance or Reliability Software Engineer where the work is
  development-heavy
- Integrations or API Engineer
- Simulation Engineer for infrastructure, networks, or systems
- Applied AI or AI Product Engineer focused on application engineering,
  evaluation, orchestration, or platform work rather than model research

### Tier 3 - selective applications

- Java, C++, Go, or Python backend roles that explicitly accept transferable
  language experience
- SRE roles dominated by software engineering, reliability tooling, or platform
  development rather than ticket operations
- Solutions Engineer roles only when most of the job is hands-on product
  engineering
- Technical lead roles only when "lead" means project ownership without senior
  tenure or people-management requirements

## Roles to deprioritize or exclude

- Frontend-only roles requiring deep design-system or UI specialization
- Mobile-only, embedded, firmware, kernel, graphics, or game-client roles
- ML research, data science, or MLOps roles requiring model training and deep ML
  expertise
- DevOps or SRE roles dominated by manual infrastructure operations and
  rotations
- Manual QA, support, implementation consulting, sales engineering, and low-code
  administration
- Staff, principal, architect, engineering-manager, and people-lead roles
- Roles with a firm 7+ year requirement or specialist requirements unrelated to
  backend and systems work

## Ideal company profile

- Product or engineering-led company with a genuine software platform or
  technically demanding product
- Problems involving scale, concurrency, routing, reliability, observability,
  networking, developer tools, workflow engines, infrastructure, or real-time
  systems
- Startup, scale-up, SaaS, cloud, developer-tools, fintech, commerce
  infrastructure, logistics, gaming infrastructure, or AI platform/product team
- A team that values design docs, automated tests, code review, measurable
  performance, and operational quality
- Enough ownership to build major components, with senior engineers available
  for mentorship and calibration
- An interview loop that rewards demonstrated systems work and project depth
  rather than only competitive-programming speed or brand-name pedigree
- Bengaluru-based (on-site, hybrid, or remote), or globally remote and able to
  hire from India through direct employment, an employer-of-record, or a
  compliant contractor arrangement

Company size is secondary to role quality. A useful initial band is roughly
20-2,000 employees: small enough for ownership and large enough to offer
engineering mentorship and credible SDE 2 progression. Exceptional companies
outside the band remain eligible.

## Bengaluru and remote filter

Treat “remote” as incomplete until the eligible hiring geography is verified.
Prioritize Bengaluru roles first. For roles located outside Bengaluru, require
both an explicit remote-work signal and explicit worldwide, global, anywhere, or
India eligibility. Also accept companies that already use an employer-of-record
or hire full-time international contractors.

For every international remote lead, capture:

- whether India is an eligible work location;
- direct employee, employer-of-record, or contractor status;
- required timezone overlap and recurring meeting hours;
- compensation currency and whether pay is globally benchmarked or
  location-adjusted;
- benefits, paid leave, equipment, probation, notice, and termination terms;
- whether the role is permanently remote or only temporarily remote.

Reject “remote” jobs restricted to the US, Canada, UK, EU, or another named
country unless sponsorship and relocation are explicitly available. Deprioritize
roles requiring a permanent night shift in India; occasional overlap with US or
European hours is acceptable if sustainable.

## Candidate-to-role evidence map

| Employer need                  | Evidence to lead with                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Distributed systems            | Built the core engine of a distributed-systems and microservices simulator                                                   |
| Routing and load balancing     | Least-response-time, power-of-two-choices, consistent-hash, header-based, and asynchronous consumer-group routing            |
| Reliability and availability   | Failure modes, single-point-of-failure detection, rate limiting, weighted fair queueing, health checks, and restart policies |
| Observability                  | HdrHistogram latency percentiles, time-weighted utilization, cache-hit metrics, and distributed tracing                      |
| Performance engineering        | C++ native-addon priority queue, zero-copy shared memory, batching, ring buffers, and million-RPS analytic simulation        |
| Cloud and delivery             | AWS EC2, ECR, CodeBuild, Docker, NGINX, GitHub Actions, and CI/CD                                                            |
| Architecture and communication | 200+ technical specs, ADRs, and design reviews                                                                               |
| Technical leadership           | Primary engineer on the simulator; separately led a data aggregation platform with a distributed team of six                 |
| API and product development    | Node.js, Express, Django REST Framework, WebSockets, PostgreSQL, MongoDB, Prisma, React, Next.js, and React Native           |
| Quality practices              | Conservation-law and Little's Law correctness tests, Cypress E2E tests, code review, and Zod validation                      |

## Search strategy

Run narrower title searches separately instead of one oversized query:

1. `("software engineer" OR "software development engineer" OR SDE) AND (I OR II OR 1 OR 2 OR backend)`
2. `("backend engineer" OR "backend developer") AND (TypeScript OR Node.js OR Java)`
3. `("distributed systems engineer" OR "platform engineer" OR "infrastructure software engineer") AND (junior OR mid OR II)`
4. `("product engineer" OR "full stack engineer") AND (backend OR Node.js OR TypeScript OR API)`
5. `("developer tools engineer" OR "simulation engineer" OR "performance engineer") AND software`
6. `("applied AI engineer" OR "AI product engineer" OR "LLM engineer") AND (backend OR TypeScript OR Node.js OR platform)`

Add one of these location clauses to each query:

- `(Bangalore OR Bengaluru)`
- `("remote worldwide" OR "global remote" OR "work from anywhere")`
- `(remote AND India)`
- `("employer of record" OR EOR OR "international contractor")`

High-value keywords include: `distributed systems`, `microservices`,
`high availability`, `fault tolerance`, `load balancing`, `consistent hashing`,
`rate limiting`, `queueing`, `message processing`, `WebSockets`,
`observability`, `distributed tracing`, `latency`, `performance`, `TypeScript`,
`Node.js`, `Java`, `C++`, `REST APIs`, `AWS`, `Docker`, `CI/CD`, `platform`,
`developer tools`, and `infrastructure software`.

## Application rules

- **Action (3.8-5.0):** Apply within 24-48 hours and seek a referral. Required
  fit is proven and the opening has multiple positive signals.
- **Keep (2.8-3.79):** Review manually. Apply when the work is compelling or a
  listed gap is clearly offset by systems depth and ownership.
- **Hold (below 2.8):** Low priority unless new evidence materially improves the
  fit.
- **Reject:** A required criterion is unproven or a hard disqualifier is
  present.

Treat experience requirements as directional. Apply to strong SDE 2 matches
asking for 4-5 years when the work aligns closely; the resume demonstrates
ownership beyond the current title. Do not self-reject solely because the
candidate has been formally titled SDE 1 since 2025. Conversely, avoid roles
whose day-to-day scope is genuinely senior or managerial.

## Core narrative for resume, LinkedIn, and outreach

> I am a backend and distributed-systems engineer with 3+ years of hands-on
> experience across TypeScript, Node.js, AWS, and production delivery. As the
> primary engineer on a distributed-systems simulator, I built core routing,
> load-balancing, fault-tolerance, observability, and performance capabilities,
> while contributing 150+ merged PRs and writing 200+ technical specs and ADRs.
> I am targeting SDE 1 and SDE 2 roles where I can own backend or platform
> components and grow into broader system-design responsibility.

For a shorter recruiter version:

> Backend/SDE candidate with 3+ years of hands-on experience in TypeScript,
> Node.js, AWS, distributed systems, reliability, and observability. Currently
> the primary engineer on a systems simulator, with 150+ merged PRs and deep
> ownership of routing, fault tolerance, metrics, tracing, and performance.

## Items to configure later

These inputs are deliberately not guessed and should be added as the search
evolves:

- Current, expected, and minimum acceptable compensation
- Maximum sustainable timezone overlap and willingness to work as a contractor
- Notice period or earliest start date
- Preferred company stages and industries
- On-call tolerance
- Any employers, industries, shifts, or employment terms to exclude
- New production metrics, user impact, scale, awards, open-source work, or
  stronger projects

Update both this document and `profiles/jobs.json` whenever those constraints or
the resume materially change.
