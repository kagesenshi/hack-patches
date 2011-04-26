/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

/*
 * Pidgin GnomeShell Integration.
 *
 * Credits to the author of Gajim extension as this extension code was modified
 * from it.
 *
 */

const DBus = imports.dbus;
const Gettext = imports.gettext.domain('gnome-shell');
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Signals = imports.signals;
const St = imports.gi.St;
const Tp = imports.gi.TelepathyGLib;

const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const MessageTray = imports.ui.messageTray;
const Shell = imports.gi.Shell;
const TelepathyClient = imports.ui.telepathyClient;

const _ = Gettext.gettext;

function wrappedText(text, sender, timestamp, direction) {
    return {
        messageType: Tp.ChannelTextMessageType.NORMAL,
        text: text,
        sender: sender,
        timestamp: timestamp,
        direction: direction
    };
}


function PidginNotification(source) {
    this._init(source);
}

function _fixText(text) {
    // remove all tags
    let _text = text.replace(/<\/?[^>]+(>|$)/g, "");
    return _text;
}

PidginNotification.prototype = {
    __proto__: TelepathyClient.Notification.prototype,

    appendMessage: function(message, noTimestamp, styles) {
        let messageBody = _fixText(message.text);
        styles = styles || [];
        styles.push(message.direction);
        this.update(this.source.title, messageBody, { customContent: true, bannerMarkup: true });
        this._append(messageBody, styles, message.timestamp, noTimestamp);
    }

}

function Source(client, account, author, initialMessage, conversation, flag) {
    this._init(client, account, author, initialMessage, conversation, flag);
}

Source.prototype = {
    __proto__: MessageTray.Source.prototype,

    _init: function(client, account, author, initialMessage, conversation, flag) {
        let proxy = client.proxy();

        let author_buddy = proxy.PurpleFindBuddySync(account, author);
        MessageTray.Source.prototype._init.call(this, author);


        this.isChat = true;
        this._author = author;
        this._author_buddy = author_buddy;
        this._client = client;
        this._account = account;
        this._conversation = conversation;
        this._initialMessage = initialMessage;
        this._iconUri = null;
        this._presence = 'online';
        this._notification = new PidginNotification(this);
        this._notification.setUrgency(MessageTray.Urgency.HIGH);

        let iconobj = proxy.PurpleBuddyGetIconSync(this._author_buddy);

        if (iconobj) {
            this._iconUri = 'file://' + proxy.PurpleBuddyIconGetFullPathSync(iconobj);
        };

        // Start!
        //

        this.title = GLib.markup_escape_text(proxy.PurpleConversationGetTitleSync(this._conversation), -1);

        this._setSummaryIcon(this.createNotificationIcon());

        Main.messageTray.add(this);

        let direction = null;
        if (flag == 1) {
            direction = TelepathyClient.NotificationDirection.SENT;
        } else if (flag == 2) {
            direction = TelepathyClient.NotificationDirection.RECEIVED;
        }

        let message = wrappedText(this._initialMessage, this._author, null, direction);
        this._notification.appendMessage(message, false);

        this._buddyStatusChangeId = proxy.connect('BuddyStatusChanged', Lang.bind(this, this._onBuddyStatusChange));
        this._buddySignedOffId = proxy.connect('BuddySignedOff', Lang.bind(this, this._onBuddySignedOff));
        this._deleteConversationId = proxy.connect('DeletingConversation', Lang.bind(this, this._onDeleteConversation));
        this._messageDisplayedId = proxy.connect('DisplayedImMsg', Lang.bind(this, this._onDisplayedImMessage));

        this.notify(this._notification);
    },

    destroy: function () {
        let proxy = this._client.proxy();
        proxy.disconnect(this._buddyStatusChangeId);
        proxy.disconnect(this._buddySignedOffId);
        proxy.disconnect(this._deleteConversationId);
        proxy.disconnect(this._messageSentId);
        proxy.disconnect(this._messageReceivedId);
        MessageTray.Source.prototype.destroy.call(this);
    },
    

    createNotificationIcon: function() {
        let iconBox = new St.Bin({ style_class: 'avatar-box' });
        iconBox._size = this.ICON_SIZE;

        if (!this._iconUri) {
            iconBox.child = new St.Icon({ icon_name: 'avatar-default',
                                          icon_type: St.IconType.FULLCOLOR,
                                          icon_size: iconBox._size });
        } else {
            let textureCache = St.TextureCache.get_default();
            iconBox.child = textureCache.load_uri_async(this._iconUri, iconBox._size, iconBox._size);
        }
        return iconBox;
    },

    open: function(notification) {
        let app = Shell.AppSystem.get_default().get_app('pidgin.desktop');
        app.activate_window(null, global.get_current_time());
    },

    notify: function () {
        MessageTray.Source.prototype.notify.call(this, this._notification);
    },

    respond: function(text) {
        let proxy = this._client.proxy();
        let _text = GLib.markup_escape_text(text, -1);
        proxy.PurpleConvImSendRemote(proxy.PurpleConvImSync(this._conversation), _text);
    },

    _onBuddyStatusChange: function (emitter, buddy, old_status_id, new_status_id) {
        if (!this.title) return;

        let proxy = this._client.proxy();

        if (buddy != this._author_buddy) return;

        // XXX: this looks wrong. should get string?
        let new_status = proxy.PurpleStatusGetIdSync(new_status_id);

        if (this._presence == new_status) return;
        this._presence = new_status;

        if (new_status == 'dnd') new_status = 'busy';
        this._notification.appendPresence('<i>' + this.title + ' is now ' + new_status + '</i>', false);
    },

    _onBuddySignedOff: function(emitter, buddy) {
        if (buddy != this._author_buddy) return;

        this._presence = 'offline';
        this._notification.appendPresence('<i>' + this.title + ' have signed off</i>', false);
    },

    _onDeleteConversation: function(emitter, conversation) {
        if (conversation != this._conversation) return;
        this.destroy();
    },


    _onDisplayedImMessage: function(emitter, account, author, text, conversation, flag) {

        if (text && (this._conversation == conversation)) {
            let direction = null;
            if (flag == 1) {
                direction = TelepathyClient.NotificationDirection.SENT;
            } else if (flag == 2) {
                direction = TelepathyClient.NotificationDirection.RECEIVED;
            }
            if (direction != null) {
                let message = wrappedText(text, this._author, null, direction);
                this._notification.appendMessage(message, false);
                this.notify(this._notification);
            } else {
                this._notification.appendPresence(message, false)
            }

        }

    }

}

const PidginIface = {
    name: 'im.pidgin.purple.PurpleInterface',
    properties: [],
    methods: [
        {name: 'PurpleGetIms', inSignature: '', outSignature: 'ai'},
        {name: 'PurpleAccountsGetAllActive', inSignature: '', outSignature: 'ai'},
        {name: 'PurpleConversationGetType', inSignature: 'i', outSignature: 'u'},
        {name: 'PurpleFindBuddies', inSignature: 'is', outSignature: 'ai'},
        {name: 'PurpleFindBuddy', inSignature: 'is', outSignature: 'i'},
        {name: 'PurpleAccountGetAlias', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleAccountGetNameForDisplay', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleBuddyGetAlias', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleBuddyGetName', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleStatusGetId', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleBuddyIconGetFullPath', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleBuddyGetIcon', inSignature: 'i', outSignature: 'i'},
        {name: 'PurpleConvImSend', inSignature: 'is', outSignature: ''},
        {name: 'PurpleConvIm', inSignature: 'i', outSignature: 'i'},
        {name: 'PurpleConvImGetIcon', inSignature: 'i', outSignature: 'i'},
        {name: 'PurpleConversationGetName', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleConversationGetAccount', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleConversationGetMessageHistory', inSignature: 'i', outSignature: 'ai'},
        {name: 'PurpleConversationMessageGetMessage', inSignature: 'i', outSignature: 's'},
        {name: 'PurpleConversationGetTitle', inSignature: 'i', outSignature: 's'},
    ],
    signals: [
        {name: 'ReceivedImMsg', inSignature: 'issiu'},
        {name: 'DisplayedImMsg', inSignature: 'issiu'},
        {name: 'SentImMsg', inSignature: 'iss'},
        {name: 'BuddyStatusChanged', inSignature: 'iii'}, // ????
        {name: 'BuddySignedOff', inSignature: 'i'},
        {name: 'BuddySignedOn', inSignature: 'i'},
        {name: 'DeletingConversation', inSignature: 'i'},
        {name: 'ConversationCreated', inSignature: 'i'}
    ]
};

let Pidgin = DBus.makeProxyClass(PidginIface);

function patchSynchronousMethods(obj, iface) {
    if ('methods' in iface) {
        let methods = iface.methods;

        for (let i = 0; i < methods.length; ++i) {
            let method = methods[i];

            if (!('name' in method))
                throw new Error("Method definition must have a name");

            if (!('outSignature' in method))
                method.outSignature = "a{sv}";

            if (!("inSignature" in method))
                method.inSignature = "a{sv}";

            if (!("timeout" in method))
                method.timeout = -1;

            let name = method.name + 'Sync';
            obj[name] = function () {
                let arg_array = Array.prototype.slice.call(arguments);
                return obj._dbusBus.call(
                    obj._dbusBusName,
                    obj._dbusPath,
                    obj._dbusInterface,
                    method.name,
                    method.outSignature,
                    method.inSignature,
                    false,
                    1000,
                    arg_array || []
                );
            }
        }
    }
    return obj;
}

function PidginClient() {
    this._init();
}

PidginClient.prototype = {
    _init: function() {
        this._sources = {};
        this._proxy = new Pidgin(DBus.session, 'im.pidgin.purple.PurpleService', '/im/pidgin/purple/PurpleObject');
        patchSynchronousMethods(this._proxy, PidginIface);
        this._proxy.connect('DisplayedImMsg', Lang.bind(this, this._messageDisplayed));
    },

    proxy: function () {
        return this._proxy;
    },

    _messageDisplayed: function(emitter, account, author, message, conversation, flag) {

        // only trigger on message received/message sent
        if (flag != 1 && flag != 2) return;

        if (conversation) {
            let source = this._sources[conversation];
            if (!source) {
                source = new Source(this, account, author, message, conversation, flag);
                source.connect('destroy', Lang.bind(this, 
                    function() {
                        delete this._sources[conversation];
                    }
                ));
            }
            this._sources[conversation] = source;
        }
    }
}


function main() {
    let client = new PidginClient();
}
