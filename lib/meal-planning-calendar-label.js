const FormData = require('form-data');
const uuid = require('./uuid');

/**
 * Meal Planning Calendar Event Label class.
 * @class
 *
 * @param {object} label label
 * @param {object} context context
 *
 * @property {string} identifier
 * @property {string} calendarId
 * @property {string} hexColor
 * @property {number} logicalTimestamp
 * @property {string} name
 * @property {number} sortIndex
 *
 */
class MealPlanningCalendarEventLabel {
	/**
   * @hideconstructor
   */
	constructor(label, {client, protobuf, uid, calendarId} = {}) {
		this.identifier = label.identifier || uuid();
		this.calendarId = label.calendarId || calendarId;
		this.hexColor = label.hexColor;
		this.logicalTimestamp = label.logicalTimestamp;
		this.name = label.name;
		this.sortIndex = label.sortIndex;

		this._client = client;
		this._protobuf = protobuf;
		this._uid = uid;
		this._isNew = !label.identifier;
		this._calendarId = calendarId;
	}

	_encode() {
		return new this._protobuf.PBCalendarLabel({
			identifier: this.identifier,
			logicalTimestamp: this.logicalTimestamp,
			calendarId: this._calendarId,
			hexColor: this.hexColor,
			name: this.name,
			sortIndex: this.sortIndex,
		});
	}

	/**
	 * Perform a calendar label operation.
	 * @private
	 * @param {string} handlerId - Handler ID for the operation
	 * @returns {Promise} - Promise representing the operation result
	 */
	async performOperation(handlerId) {
		const ops = new this._protobuf.PBCalendarOperationList();
		const op = new this._protobuf.PBCalendarOperation();

		op.setMetadata({
			operationId: uuid(),
			handlerId,
			userId: this._uid,
		});

		op.setCalendarId(this._calendarId);
		op.setUpdatedLabel(this._encode());
		ops.setOperations([op]);

		const form = new FormData();

		form.append('operations', ops.toBuffer());
		await this._client.post('data/meal-planning-calendar/update', {
			body: form,
		});
	}

	/**
	 * Save local changes to the calendar label to AnyList's API.
	 * @return {Promise}
	 */
	async save() {
		const operation = this._isNew ? 'new-label' : 'update-label';
		await this.performOperation(operation);
		this._isNew = false;
	}

	/**
	 * Delete this label from the calendar via AnyList's API.
	 * @return {Promise}
	 */
	async delete() {
		await this.performOperation('delete-label');
	}
}

module.exports = MealPlanningCalendarEventLabel;
