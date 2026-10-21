import { Model, Types } from 'mongoose';

/**
 * A daily campaign has a hidden "explore" child (see DailyService). Everything the client sees or does goes through the
 * PARENT, which stands for both: this resolves any campaign id (parent or child) to the parent and its child.
 */
export interface CampaignFamily {
  root: any;
  child: any | null;
  /** [parent, child?] */
  ids: Types.ObjectId[];
}

export async function campaignFamily(model: Model<any>, campaignId: string | Types.ObjectId, extra: Record<string, unknown> = {}): Promise<CampaignFamily | null> {
  let doc = await model.findOne({ _id: campaignId, ...extra });
  if (!doc) return null;
  if (doc.parentCampaignId) doc = (await model.findOne({ _id: doc.parentCampaignId, ...extra })) ?? doc;
  const child = doc.exploreCampaignId ? await model.findOne({ _id: doc.exploreCampaignId, ...extra }) : null;
  return { root: doc, child, ids: [doc._id, ...(child ? [child._id] : [])] };
}

/** The status the client should see for the pair: the parent's, unless the explore part is still working. */
export function familyStatus(rootStatus: string, child: { status: string; progress?: { message?: string } } | null, terminal: string[]): { status: string; progressMessage: string | null } {
  if (child && terminal.includes(rootStatus) && !terminal.includes(child.status)) return { status: child.status, progressMessage: child.progress?.message ?? null };
  return { status: rootStatus, progressMessage: null };
}
