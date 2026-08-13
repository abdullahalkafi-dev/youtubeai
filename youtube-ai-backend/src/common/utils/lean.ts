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
    if (result[key]?._bsontype === 'ObjectId') {
      result[key] = result[key].toString();
    }
  }
  return result;
}

/**
 * Convert an array of Mongoose lean() results.
 */
export function leanDocs(docs: any[]): any[] {
  return docs.map(leanDoc);
}
