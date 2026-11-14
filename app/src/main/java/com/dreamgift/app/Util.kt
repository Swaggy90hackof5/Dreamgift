package com.dreamgift.app

import android.content.Context
import android.content.Intent
import android.net.Uri

/** Formats a rupee amount with Indian digit grouping, e.g. 1000000 -> ₹10,00,000 */
fun inr(n: Long): String {
    val s = n.toString()
    if (s.length <= 3) return "₹$s"
    val last3 = s.takeLast(3)
    var rest = s.dropLast(3)
    val sb = StringBuilder()
    while (rest.length > 2) {
        sb.insert(0, "," + rest.takeLast(2))
        rest = rest.dropLast(2)
    }
    sb.insert(0, rest)
    return "₹$sb,$last3"
}

fun guestLink(slug: String): String = "${BuildConfig.BASE_URL}/r/$slug"

/** Shares the guest link (WhatsApp, Instagram DM, SMS...). Guests don't need the app. */
fun shareWishlist(context: Context, w: Wishlist) {
    val text = buildString {
        append("💍 ${w.coupleName}'s Dream Wishlist\n")
        append("No more mixers! Help us reach our dreams instead 🙏\n\n")
        w.dreams.forEach { append("${it.emoji} ${it.title} - ${inr(it.target)}\n") }
        append("\nSee our dreams and send a gift of any amount here:\n")
        append(guestLink(w.slug))
    }
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    context.startActivity(Intent.createChooser(send, "Share wishlist").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

fun openGuestPage(context: Context, slug: String) {
    val i = Intent(Intent.ACTION_VIEW, Uri.parse(guestLink(slug))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(i)
}
