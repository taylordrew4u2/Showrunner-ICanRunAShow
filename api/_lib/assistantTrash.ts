// Deleting a show through an assistant: never a hard delete.
//
// The show goes to Recently deleted exactly as the app's delete puts it there
// (App.handleDeleteShow): a trash entry holding the show without its embedded
// audio, its id on the deleted record so an old held copy on some device
// cannot bring it back, and its row removed from the list. Restoring it from
// Settings → Recently deleted in the app brings it back.
//
// One difference, on purpose: the app's trash keeps twenty shows, and a
// deletion past that permanently removes the oldest one. An assistant may not
// destroy a show the producer did not name, so a full trash is refused and
// left for the producer to empty or restore from in the app.
import { MAX_DELETED_SHOW_IDS, type DeletedItem } from '../../src/types';
import { MAX_TRASH_ITEMS, stripShowMediaForTrash } from '../../src/utils/trash';
import {
  args, AssistantToolError, confirmed, loadShowAt, loadWritableSettings, saveSettings, saveShows,
  type AssistantTool,
} from './assistantCore';
import { revisionSchema } from './chatgptShows';

export const deleteShow: AssistantTool = {
  scope: 'shows:delete',
  definition: {
    name: 'delete_show',
    title: 'Delete a show',
    description: 'Move a show to the app’s Recently deleted, as the app’s own Delete does; the producer can restore it from Settings → Recently deleted. Never deletes permanently: if Recently deleted is full (20 shows), this is refused rather than pushing the oldest one out. Always confirm the exact show with the producer first, then pass confirm: true with the revision from get_show.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 128 },
        expected_revision: revisionSchema,
        confirm: { type: 'boolean', const: true, description: 'True only once the producer has confirmed this deletion.' },
      },
      required: ['id', 'expected_revision', 'confirm'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async run(ctx, input) {
    const a = args(input, ['id', 'expected_revision', 'confirm']);
    confirmed(a.confirm);
    const loaded = await loadShowAt(ctx, a.id, a.expected_revision);
    const settings = await loadWritableSettings(ctx);
    const trash = settings.settings.trash ?? [];
    if (trash.length >= MAX_TRASH_ITEMS) {
      throw new AssistantToolError(`Recently deleted is full (${MAX_TRASH_ITEMS} shows), and deleting another would permanently remove the oldest. Ask the producer to empty or restore something from Settings → Recently deleted in the app first.`);
    }
    const show = loaded.show;
    const item: DeletedItem = {
      id: crypto.randomUUID(),
      type: 'show',
      data: stripShowMediaForTrash(show),
      deletedAt: new Date().toISOString(),
    };
    const next = {
      ...settings.settings,
      trash: [item, ...trash],
      deletedShowIds: [show.id, ...(settings.settings.deletedShowIds ?? []).filter(id => id !== show.id)].slice(0, MAX_DELETED_SHOW_IDS),
    };
    // The trash entry is saved before the show is taken off the list, so no
    // failure in between can leave the show in neither place.
    await saveSettings(ctx, settings, next);
    try {
      await saveShows(ctx, [{ id: show.id, expectedHash: loaded.revision, show: null }]);
    } catch (err) {
      // The show changed in the moment between the two writes. Take the
      // trash entry back out, written over the settings as they are now so a
      // newer save is never overwritten. Should that fail too, the show is
      // still listed and its copy in the trash is harmless — restoring it
      // does not duplicate a show that is already there.
      try {
        const current = await loadWritableSettings(ctx);
        if ((current.settings.trash ?? [])[0]?.id === item.id) {
          await saveSettings(ctx, current, {
            ...current.settings,
            trash: (current.settings.trash ?? []).filter(entry => entry.id !== item.id),
            deletedShowIds: (current.settings.deletedShowIds ?? []).filter(id => id !== show.id),
          });
        }
      } catch { /* left as described above */ }
      throw err;
    }
    return {
      deleted: { id: show.id, name: show.name },
      trashId: item.id,
      message: `${show.name} is in Recently deleted. The producer can restore it from Settings → Recently deleted in the app.`,
    };
  },
};
