import { syncSearchRepo } from "../jobs/search-repo.js";

const result = syncSearchRepo();
process.stdout.write(
  `${JSON.stringify({ committed: result.committed, pushed: result.pushed, inSync: !result.state.dirty && result.state.ahead === 0 }, null, 2)}\n`,
);
