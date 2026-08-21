/**
 * Convert a Mongoose lean() result to have proper string `id` field.
 * lean() bypasses the toJSON transform, so _id stays as ObjectId.
 * This function manually converts _id → id and deletes __v.
 */
export function leanDoc(doc: any): any {
  if (!doc) return doc;
  const id = doc._id ? doc._id.toString() : doc.id ? String(doc.id) : '';
  const result: any = { id, ...doc };
  delete result._id;
  delete result.__v;
  // Convert ObjectId fields to strings
  for (const key of Object.keys(result)) {
    if (result[key]?._bsontype === 'ObjectId' || (result[key] && typeof result[key] === 'object' && result[key]._bsontype === 'ObjectID')) {
      result[key] = result[key].toString();
    }
  }
  // Convert nested messages array to have proper string id and _id
  if (Array.isArray(result.messages)) {
    result.messages = result.messages.map((m: any) => {
      const msgId = m._id ? m._id.toString() : m.id ? String(m.id) : '';
      return {
        ...m,
        id: msgId,
        _id: msgId,
      };
    });
  }
  return result;
}

/**
 * Convert an array of Mongoose lean() results.
 */
export function leanDocs(docs: any[]): any[] {
  return docs.map(leanDoc);
}
