export type CacheRecord = {
  id: string;
  kind: 'delivery' | 'invoice' | 'tax' | 'insurance' | 'vehicle';
  payload: unknown;
  createdAt: string;
};

export class TemporaryServerCache {
  private records: CacheRecord[] = [];

  save(record: CacheRecord) {
    this.records.push(record);
    return record;
  }

  list() {
    return [...this.records];
  }

  clear() {
    this.records = [];
  }
}
