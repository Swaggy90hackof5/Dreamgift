package com.dreamgift.app

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val UPI_REGEX = Regex("^[a-zA-Z0-9.\\-_]{2,256}@[a-zA-Z]{2,64}$")
private val EMOJIS = listOf("✈️", "🏠", "🏝️", "🏍️", "🚗", "💍", "🎓", "🛋️", "🎶", "🌏")
private val GOLD = Color(0xFFFFD27A)

private fun friendly(e: Exception): String = when (e) {
    is ApiException -> e.message ?: "Something went wrong"
    else -> "Can't reach the server. Check your internet connection."
}

/* ------------------------------------------------------------------ */
/* Setup (create or edit)                                              */
/* ------------------------------------------------------------------ */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetupScreen(
    initial: Wishlist?,
    onSubmit: suspend (p1: String, p2: String, upi: String) -> Unit,
    onCancel: (() -> Unit)?
) {
    var p1 by remember { mutableStateOf(initial?.partner1 ?: "") }
    var p2 by remember { mutableStateOf(initial?.partner2 ?: "") }
    var upi by remember { mutableStateOf(initial?.upiId ?: "") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val upiValid = UPI_REGEX.matches(upi.trim())
    val canSave = p1.isNotBlank() && upiValid && !busy
    val isFirstTime = initial == null

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (isFirstTime) "Create your wishlist" else "Edit details", fontWeight = FontWeight.Bold) },
                actions = { if (onCancel != null) TextButton(onClick = onCancel) { Text("Cancel") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background)
            )
        }
    ) { pad ->
        Column(
            Modifier
                .padding(pad)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text("💍", fontSize = 48.sp)
            Text(
                "Skip the fourth mixer. Tell your guests what you're actually dreaming of.",
                style = MaterialTheme.typography.titleMedium
            )
            OutlinedTextField(
                value = p1, onValueChange = { p1 = it },
                label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = p2, onValueChange = { p2 = it },
                label = { Text("Partner's name") }, singleLine = true, modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = upi, onValueChange = { upi = it.trim() },
                label = { Text("Your UPI ID (e.g. name@okhdfcbank)") },
                singleLine = true,
                isError = upi.isNotEmpty() && !upiValid,
                supportingText = {
                    Text(
                        if (upi.isNotEmpty() && !upiValid) "That doesn't look like a UPI ID"
                        else "Used when guests choose to pay you directly by UPI."
                    )
                },
                modifier = Modifier.fillMaxWidth()
            )
            if (error != null) Text(error!!, color = MaterialTheme.colorScheme.error)
            Button(
                onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            onSubmit(p1.trim(), p2.trim(), upi.trim())
                        } catch (e: Exception) {
                            error = friendly(e)
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = canSave,
                modifier = Modifier.fillMaxWidth()
            ) {
                if (busy) CircularProgressIndicator(Modifier.height(20.dp), strokeWidth = 2.dp, color = Color.White)
                else Text(if (isFirstTime) "Create our wishlist" else "Save")
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    session: Session,
    onEditDetails: (Wishlist) -> Unit,
    onSessionLost: () -> Unit,
    onDeleted: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var wishlist by remember { mutableStateOf<Wishlist?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showAddDream by remember { mutableStateOf(false) }
    var editingDream by remember { mutableStateOf<Dream?>(null) }
    var menuOpen by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    // Live progress: poll the server every few seconds while this screen is visible.
    LaunchedEffect(session) {
        while (true) {
            try {
                wishlist = Api.owner(session)
                error = null
            } catch (e: ApiException) {
                if (e.code == 401 || e.code == 404) {
                    onSessionLost()
                    return@LaunchedEffect
                }
                error = friendly(e)
            } catch (e: Exception) {
                error = friendly(e)
            }
            delay(8_000)
        }
    }

    fun act(block: suspend () -> Wishlist) {
        scope.launch {
            try {
                wishlist = block()
                error = null
            } catch (e: Exception) {
                error = friendly(e)
            }
        }
    }

    val w = wishlist
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("DreamGift", fontWeight = FontWeight.Bold) },
                actions = {
                    TextButton(enabled = w != null, onClick = { w?.let { shareWishlist(context, it) } }) { Text("Share") }
                    TextButton(onClick = { menuOpen = true }) { Text("⋮", fontSize = 20.sp) }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(text = { Text("Preview guest page") }, onClick = {
                            menuOpen = false
                            openGuestPage(context, session.slug)
                        })
                        DropdownMenuItem(text = { Text("Edit details") }, onClick = {
                            menuOpen = false
                            w?.let(onEditDetails)
                        })
                        DropdownMenuItem(
                            text = { Text("Delete wishlist", color = MaterialTheme.colorScheme.error) },
                            onClick = {
                                menuOpen = false
                                confirmDelete = true
                            })
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background)
            )
        },
        floatingActionButton = {
            if (w != null) {
                ExtendedFloatingActionButton(onClick = { showAddDream = true }) {
                    Text("+  Add a dream", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    ) { pad ->
        if (w == null) {
            Column(
                Modifier.padding(pad).fillMaxSize().padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                if (error == null) CircularProgressIndicator()
                else Text(error!!, color = MaterialTheme.colorScheme.error)
            }
        } else {
            LazyColumn(
                modifier = Modifier.padding(pad).fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (error != null) {
                    item { Text(error!!, color = MaterialTheme.colorScheme.error) }
                }
                item { SummaryCard(w) }

                item {
                    OutlinedButton(onClick = { shareWishlist(context, w) }, modifier = Modifier.fillMaxWidth()) {
                        Text("Share your wishlist link with guests")
                    }
                }

                if (w.pending.isNotEmpty()) {
                    item {
                        Text(
                            "Confirm direct UPI gifts",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            "Guests who paid your UPI ID directly. Confirm only after the money reached your account.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    items(w.pending, key = { "p${it.id}" }) { g ->
                        PendingCard(
                            g, w.dreamOf(g.dreamId),
                            onConfirm = { act { Api.confirmGift(session, g.id) } },
                            onReject = { act { Api.rejectGift(session, g.id) } }
                        )
                    }
                }

                item {
                    Text(
                        "Your dreams",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
                items(w.dreams, key = { "d${it.id}" }) { d -> DreamCard(d, onEdit = { editingDream = d }) }

                item {
                    Text(
                        "Blessings & gifts",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
                if (w.gifts.isEmpty()) {
                    item {
                        Text(
                            "Nothing yet. Share your link and watch the love roll in.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    items(w.gifts, key = { "g${it.id}" }) { g -> GiftRow(g, w.dreamOf(g.dreamId)) }
                }
            }
        }
    }

    if (showAddDream) {
        DreamDialog(
            initial = null,
            onSave = { emoji, title, target ->
                showAddDream = false
                act { Api.addDream(session, emoji, title, target) }
            },
            onDelete = null,
            onDismiss = { showAddDream = false }
        )
    }

    editingDream?.let { current ->
        DreamDialog(
            initial = current,
            onSave = { emoji, title, target ->
                editingDream = null
                act { Api.editDream(session, current.id, emoji, title, target) }
            },
            onDelete = {
                editingDream = null
                act { Api.deleteDream(session, current.id) }
            },
            onDismiss = { editingDream = null }
        )
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            containerColor = Color.White,
            title = { Text("Delete your wishlist?") },
            text = { Text("This permanently deletes your dreams and every gift message, and the link you shared will stop working.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    scope.launch {
                        try {
                            Api.deleteWishlist(session)
                            onDeleted()
                        } catch (e: Exception) {
                            error = friendly(e)
                        }
                    }
                }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Keep it") } }
        )
    }
}

@Composable
private fun SummaryCard(w: Wishlist) {
    val progress = if (w.totalGoal > 0) (w.totalRaised.toFloat() / w.totalGoal).coerceIn(0f, 1f) else 0f
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(20.dp)) {
            Text(
                "${w.coupleName}'s Dream Wishlist",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimary
            )
            Text("No more mixers. Gift a dream instead.", color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f))
            Spacer(Modifier.height(16.dp))
            Text(inr(w.totalRaised), style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold, color = GOLD)
            Text("raised of ${inr(w.totalGoal)}", color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f))
            Spacer(Modifier.height(12.dp))
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxWidth().height(8.dp),
                color = GOLD,
                trackColor = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.25f),
                strokeCap = StrokeCap.Round
            )
        }
    }
}

@Composable
private fun DreamCard(d: Dream, onEdit: () -> Unit) {
    val progress = if (d.target > 0) (d.raised.toFloat() / d.target).coerceIn(0f, 1f) else 0f
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(d.emoji, fontSize = 32.sp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(d.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        "${inr(d.raised)} of ${inr(d.target)}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Text("${(progress * 100).toInt()}%", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            }
            Spacer(Modifier.height(12.dp))
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxWidth().height(8.dp),
                strokeCap = StrokeCap.Round
            )
            TextButton(onClick = onEdit) { Text("Edit") }
        }
    }
}

@Composable
private fun PendingCard(g: Gift, dream: Dream?, onConfirm: () -> Unit, onReject: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF3D6)), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Row {
                Column(Modifier.weight(1f)) {
                    Text(g.guest, fontWeight = FontWeight.Bold)
                    Text(
                        "${dream?.emoji ?: ""} ${dream?.title ?: "Gift"}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (g.message.isNotBlank()) Text("“${g.message}”", modifier = Modifier.padding(top = 4.dp))
                }
                Text(inr(g.amount), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            }
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onConfirm) { Text("Received") }
                OutlinedButton(onClick = onReject) { Text("Not received") }
            }
        }
    }
}

@Composable
private fun GiftRow(g: Gift, dream: Dream?) {
    val date = remember(g.createdAt) { SimpleDateFormat("d MMM", Locale.getDefault()).format(Date(g.createdAt)) }
    Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(g.guest, fontWeight = FontWeight.Bold)
                Text(
                    "${dream?.emoji ?: ""} ${dream?.title ?: "Gift"} · $date",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (g.message.isNotBlank()) {
                    Text("“${g.message}”", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
                }
            }
            Text(inr(g.amount), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        }
    }
}

/* ------------------------------------------------------------------ */
/* Dream dialog                                                        */
/* ------------------------------------------------------------------ */

@Composable
private fun DreamDialog(
    initial: Dream?,
    onSave: (emoji: String, title: String, target: Long) -> Unit,
    onDelete: (() -> Unit)?,
    onDismiss: () -> Unit
) {
    var emoji by remember { mutableStateOf(initial?.emoji ?: "✈️") }
    var title by remember { mutableStateOf(initial?.title ?: "") }
    var target by remember { mutableStateOf(initial?.target?.toString() ?: "") }
    val amount = target.toLongOrNull() ?: 0L

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        title = { Text(if (initial == null) "Add a dream" else "Edit dream") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    EMOJIS.forEach { e ->
                        FilterChip(selected = e == emoji, onClick = { emoji = e }, label = { Text(e, fontSize = 20.sp) })
                    }
                }
                OutlinedTextField(
                    value = title, onValueChange = { title = it },
                    label = { Text("What are you dreaming of?") }, singleLine = true
                )
                OutlinedTextField(
                    value = target,
                    onValueChange = { target = it.filter(Char::isDigit).take(9) },
                    label = { Text("Target amount (₹, min 100)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true
                )
                if (onDelete != null) {
                    Text(
                        "A dream that already has gifts can't be deleted, only edited.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        },
        confirmButton = {
            Button(enabled = title.isNotBlank() && amount >= 100, onClick = { onSave(emoji, title.trim(), amount) }) {
                Text("Save")
            }
        },
        dismissButton = {
            Row {
                if (onDelete != null) {
                    TextButton(onClick = onDelete) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                }
                TextButton(onClick = onDismiss) { Text("Cancel") }
            }
        }
    )
}
