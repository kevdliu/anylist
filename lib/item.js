const FormData = require('form-data');
const uuid = require('./uuid');

const OP_MAPPING = {
	name: 'set-list-item-name',
	quantity: 'set-list-item-quantity',
	details: 'set-list-item-details',
	checked: 'set-list-item-checked',
	categoryMatchId: 'set-list-item-category-match-id',
	manualSortIndex: 'set-list-item-sort-order',
};

/**
 * Item class.
 * @class
 *
 * @param {object} item item
 * @param {object} context context
 *
 * @property {string} listId
 * @property {string} identifier
 * @property {string} name
 * @property {string} details
 * @property {string} quantity
 * @property {string} checked
 * @property {string} manualSortIndex
 * @property {string} userId
 * @property {string} categoryMatchId
 */
class Item {
	/**
   * @hideconstructor
   */
	constructor(i, {client, protobuf, uid}) {
		this._listId = i.listId;
		this._identifier = i.identifier || uuid();
		this._name = i.name;
		this._details = i.details;
		// Read quantity from quantityPb.amount, deprecatedQuantity, or fall back to quantity
		this._quantity = i.quantityPb?.amount ?? i.deprecatedQuantity ?? i.quantity;
		this._checked = i.checked;
		this._manualSortIndex = i.manualSortIndex;
		this._userId = i.userId;
		this._categoryMatchId = i.categoryMatchId;
		this._storeIds = i.storeIds || [];
		this._client = client;
		this._protobuf = protobuf;
		this._uid = uid;

		this._fieldsToUpdate = [];
	}

	toJSON() {
		return {
			listId: this._listId,
			identifier: this._identifier,
			name: this._name,
			details: this._details,
			quantity: this._quantity,
			checked: this._checked,
			manualSortIndex: this._manualSortIndex,
			userId: this._userId,
			categoryMatchId: this._categoryMatchId,
			storeIds: this._storeIds,
		};
	}

	_encode() {
		const item = {
			identifier: this._identifier,
			listId: this._listId,
			name: this._name,
			details: this._details,
			checked: this._checked,
			category: this._category,
			userId: this._userId,
			categoryMatchId: this._categoryMatchId,
			manualSortIndex: this._manualSortIndex,
			storeIds: this._storeIds,
		};

		// Encode quantity as quantityPb.amount per protobuf schema (must be string)
		if (this._quantity) {
			item.quantityPb = {amount: String(this._quantity)};
		}

		return new this._protobuf.ListItem(item);
	}

	get identifier() {
		return this._identifier;
	}

	set identifier(_) {
		throw new Error('You cannot update an item ID.');
	}

	get listId() {
		return this._listId;
	}

	set listId(l) {
		if (this._listId === undefined) {
			this._listId = l;
			this._fieldsToUpdate.push('listId');
		} else {
			throw new Error('You cannot move items between lists.');
		}
	}

	get name() {
		return this._name;
	}

	set name(n) {
		this._name = n;
		this._fieldsToUpdate.push('name');
	}

	get quantity() {
		return this._quantity;
	}

	set quantity(q) {
		if (typeof q === 'number') {
			q = q.toString();
		}

		this._quantity = q;
		this._fieldsToUpdate.push('quantity');
	}

	get details() {
		return this._details;
	}

	set details(d) {
		this._details = d;
		this._fieldsToUpdate.push('details');
	}

	get checked() {
		return this._checked;
	}

	set checked(c) {
		if (typeof c !== 'boolean') {
			throw new TypeError('Checked must be a boolean.');
		}

		this._checked = c;
		this._fieldsToUpdate.push('checked');
	}

	get userId() {
		return this._userId;
	}

	set userId(_) {
		throw new Error('Cannot set user ID of an item after creation.');
	}

	get categoryMatchId() {
		return this._categoryMatchId;
	}

	set categoryMatchId(i) {
		this._categoryMatchId = i;
		this._fieldsToUpdate.push('categoryMatchId');
	}

	get storeIds() {
		return this._storeIds;
	}

	get manualSortIndex() {
		return this._manualSortIndex;
	}

	set manualSortIndex(i) {
		if (typeof i !== 'number') {
			throw new TypeError('Sort index must be a number.');
		}

		this._manualSortIndex = i;
		this._fieldsToUpdate.push('manualSortIndex');
	}

	/**
   * Assign this item to the given stores (by store ID),
   * or pass an empty array to clear its store assignment.
   * AnyList tracks store assignment per store ID, so this
   * reconciles the current set against the desired set,
   * adding/removing individual store IDs as needed, and
   * sends the change to AnyList's API immediately.
   * Must set `isFavorite=true` if editing "favorites" list
   * @param {string[]} [storeIds=[]]
   * @param {boolean} [isFavorite=false]
   * @return {Promise}
   */
	async setStores(storeIds = [], isFavorite = false) {
		const current = this._storeIds || [];
		const toAdd = storeIds.filter(id => !current.includes(id));
		const toRemove = current.filter(id => !storeIds.includes(id));

		const ops = [];

		for (const [handlerId, ids] of [['add-list-item-store-id', toAdd], ['remove-list-item-store-id', toRemove]]) {
			for (const storeId of ids) {
				const op = new this._protobuf.PBListOperation();

				op.setMetadata({
					operationId: uuid(),
					handlerId,
					userId: this._uid,
				});

				op.setListId(this._listId);
				op.setListItemId(this._identifier);
				op.setUpdatedValue(storeId);

				ops.push(op);
			}
		}

		this._storeIds = storeIds;

		if (ops.length === 0) {
			return;
		}

		const opList = new this._protobuf.PBListOperationList();

		opList.setOperations(ops);

		const form = new FormData();

		form.append('operations', opList.toBuffer());

		await this._client.post(isFavorite ? 'data/starter-lists/update' : 'data/shopping-lists/update', {
			body: form,
		});
	}

	/**
   * Save local changes to item to
   * AnyList's API.
   * Must set `isFavorite=true` if editing "favorites" list
   * @param {boolean} [isFavorite=false]
   * @return {Promise}
   */
	async save(isFavorite = false) {
		const ops = this._fieldsToUpdate.map(field => {
			const value = this[field];
			const opName = OP_MAPPING[field];

			const op = new this._protobuf.PBListOperation();

			op.setMetadata({
				operationId: uuid(),
				handlerId: opName,
				userId: this._uid,
			});

			op.setListId(this._listId);
			op.setListItemId(this._identifier);

			if (typeof value === 'boolean') {
				op.setUpdatedValue(value === true ? 'y' : 'n');
			} else {
				op.setUpdatedValue(value.toString());
			}

			return op;
		});

		const opList = new this._protobuf.PBListOperationList();

		opList.setOperations(ops);

		const form = new FormData();

		form.append('operations', opList.toBuffer());

		await this._client.post(isFavorite ? 'data/starter-lists/update' : 'data/shopping-lists/update', {
			body: form,
		});
	}
}

module.exports = Item;
