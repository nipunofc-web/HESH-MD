const mongoose = require('mongoose');
const { proto } = require('@whiskeysockets/baileys/WAProto');
const { BufferJSON, initAuthCreds } = require('@whiskeysockets/baileys');

const AuthSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    data: { type: String, required: true }
});

const Auth = mongoose.models.Auth || mongoose.model('Auth', AuthSchema);

async function useMongoDBAuthState(sessionId) {
    const writeData = async (data, id) => {
        const informationToStore = JSON.stringify(data, BufferJSON.replacer);
        await Auth.updateOne(
            { _id: `${sessionId}-${id}` },
            { data: informationToStore },
            { upsert: true }
        );
    };

    const readData = async (id) => {
        try {
            const data = await Auth.findOne({ _id: `${sessionId}-${id}` });
            if (data && data.data) {
                return JSON.parse(data.data, BufferJSON.reviver);
            }
            return null;
        } catch (error) {
            return null;
        }
    };

    const removeData = async (id) => {
        await Auth.deleteOne({ _id: `${sessionId}-${id}` });
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(value, key));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds'),
        clearSessionData: async () => {
            await Auth.deleteMany({ _id: new RegExp(`^${sessionId}-`) });
        }
    };
}

module.exports = { useMongoDBAuthState, Auth };
