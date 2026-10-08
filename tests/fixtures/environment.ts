export const validEnvironment = (): NodeJS.ProcessEnv => ({
  TRACKER_SHEET_ID: "tracker-id",
  SALES_BRAIN_DOC_ID: "sales-brain-id",
  PROMPT_LIBRARY_DOC_ID: "prompt-library-id",
  PROPOSAL_TEMPLATE_DOC_ID: "proposal-template-id",
  BRIEFS_FOLDER_ID: "briefs-folder-id",
  PROPOSALS_FOLDER_ID: "proposals-folder-id",
  TRANSCRIPTS_FOLDER_ID: "transcripts-folder-id",
  OWNER_EMAIL: "owner@example.com",
  LLM_PROVIDER: "fake",
  LLM_MODEL_FAST: "fake-fast",
  LLM_MODEL_WRITER: "fake-writer",
  SEARCH_PROVIDER: "fake",
});
