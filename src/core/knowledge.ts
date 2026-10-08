export interface KnowledgeFile {
  id: string;
  title: string;
  text: string;
  retrievedAt: string;
}

export interface KnowledgeReader {
  read(documentId: string): Promise<KnowledgeFile>;
}
