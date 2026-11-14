package com.dreamgift.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val code: Int, message: String) : Exception(message)

/** Minimal HTTP client for the DreamGift backend (no third-party dependencies). */
object Api {
    private fun request(method: String, path: String, token: String?, body: JSONObject?): JSONObject {
        val conn = URL(BuildConfig.BASE_URL + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.setRequestProperty("Accept", "application/json")
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (code !in 200..299) {
                throw ApiException(code, json.optString("error", "Something went wrong ($code)"))
            }
            return json
        } finally {
            conn.disconnect()
        }
    }

    private suspend fun call(method: String, path: String, token: String? = null, body: JSONObject? = null) =
        withContext(Dispatchers.IO) { request(method, path, token, body) }

    suspend fun createWishlist(p1: String, p2: String, upi: String): Session {
        val r = call(
            "POST", "/api/registries",
            body = JSONObject().put("partner1", p1).put("partner2", p2).put("upiId", upi)
        )
        return Session(r.getString("slug"), r.getString("ownerToken"))
    }

    suspend fun owner(s: Session) = parseWishlist(call("GET", "/api/r/${s.slug}/owner", s.token))

    suspend fun updateDetails(s: Session, p1: String, p2: String, upi: String) = parseWishlist(
        call(
            "PUT", "/api/r/${s.slug}", s.token,
            JSONObject().put("partner1", p1).put("partner2", p2).put("upiId", upi)
        )
    )

    suspend fun addDream(s: Session, emoji: String, title: String, target: Long) = parseWishlist(
        call(
            "POST", "/api/r/${s.slug}/dreams", s.token,
            JSONObject().put("emoji", emoji).put("title", title).put("target", target)
        )
    )

    suspend fun editDream(s: Session, id: Long, emoji: String, title: String, target: Long) = parseWishlist(
        call(
            "PUT", "/api/r/${s.slug}/dreams/$id", s.token,
            JSONObject().put("emoji", emoji).put("title", title).put("target", target)
        )
    )

    suspend fun deleteDream(s: Session, id: Long) =
        parseWishlist(call("DELETE", "/api/r/${s.slug}/dreams/$id", s.token))

    suspend fun confirmGift(s: Session, id: Long) =
        parseWishlist(call("POST", "/api/r/${s.slug}/contributions/$id/confirm", s.token))

    suspend fun rejectGift(s: Session, id: Long) =
        parseWishlist(call("POST", "/api/r/${s.slug}/contributions/$id/reject", s.token))

    suspend fun deleteWishlist(s: Session) {
        call("DELETE", "/api/r/${s.slug}", s.token)
    }
}
