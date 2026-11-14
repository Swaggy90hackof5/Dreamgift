package com.dreamgift.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class Dream(
    val id: Long,
    val emoji: String,
    val title: String,
    val target: Long,
    val raised: Long
)

data class Gift(
    val id: Long,
    val dreamId: Long,
    val guest: String,
    val amount: Long,
    val message: String,
    val createdAt: Long
)

data class Wishlist(
    val slug: String,
    val partner1: String,
    val partner2: String,
    val coupleName: String,
    val upiId: String,
    val onlinePayments: Boolean,
    val dreams: List<Dream>,
    val totalRaised: Long,
    val totalGoal: Long,
    val gifts: List<Gift>,
    val pending: List<Gift>
) {
    fun dreamOf(id: Long): Dream? = dreams.firstOrNull { it.id == id }
}

data class Session(val slug: String, val token: String)

/** Stores the wishlist's slug and secret owner token on this phone. */
class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("dreamgift_session", Context.MODE_PRIVATE)

    fun load(): Session? {
        val slug = prefs.getString("slug", null) ?: return null
        val token = prefs.getString("token", null) ?: return null
        return Session(slug, token)
    }

    fun save(s: Session) {
        prefs.edit().putString("slug", s.slug).putString("token", s.token).apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}

private fun JSONArray.toList(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

private fun parseGift(o: JSONObject) = Gift(
    id = o.getLong("id"),
    dreamId = o.getLong("dreamId"),
    guest = o.optString("guest", "Guest"),
    amount = o.getLong("amount"),
    message = o.optString("message", ""),
    createdAt = o.optLong("createdAt", 0L)
)

fun parseWishlist(o: JSONObject): Wishlist = Wishlist(
    slug = o.getString("slug"),
    partner1 = o.getString("partner1"),
    partner2 = o.optString("partner2", ""),
    coupleName = o.getString("coupleName"),
    upiId = o.getString("upiId"),
    onlinePayments = o.optBoolean("onlinePayments", false),
    dreams = (o.optJSONArray("dreams") ?: JSONArray()).toList().map {
        Dream(
            id = it.getLong("id"),
            emoji = it.optString("emoji", "✨"),
            title = it.getString("title"),
            target = it.getLong("target"),
            raised = it.optLong("raised", 0L)
        )
    },
    totalRaised = o.optLong("totalRaised", 0L),
    totalGoal = o.optLong("totalGoal", 0L),
    gifts = (o.optJSONArray("contributions") ?: JSONArray()).toList().map(::parseGift),
    pending = (o.optJSONArray("pending") ?: JSONArray()).toList().map(::parseGift)
)
