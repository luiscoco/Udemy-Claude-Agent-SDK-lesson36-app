import { renderMarkdown } from "./markdown.js";
const get = (id) => document.getElementById(id);
const run = get("run");
const rows = [], observations = [];
let complete = false;
function json(id, value) {
    get(id).textContent = JSON.stringify(value, null, 2);
    Prism.highlightElement(get(id));
}
function blocks(value) {
    // Replace each block view from a snapshot; never append a complete reply twice.
    const fragment = document.createDocumentFragment();
    for (const b of value.filter((b) => b.type === "text")) {
        const card = document.createElement("article");
        card.className = "response-block";
        const status = document.createElement("p");
        status.className = "meta";
        status.textContent = b.authoritative
            ? "Complete SDK text block"
            : "Provisional text · receiving actual deltas";
        const text = document.createElement("div");
        if (b.authoritative)
            renderMarkdown(text, b.text);
        else {
            text.textContent = b.text;
            text.className = "partial-text";
        }
        card.append(status, text);
        fragment.append(card);
    }
    get("conversation").replaceChildren(fragment);
    json("block-data", value);
    get("delta-count").textContent = String(observations.filter((o) => o.kind === "raw-event" &&
        o.detail.delta?.type === "text_delta").length);
}
const select = get("observation-select");
select.onchange = () => json("selected-observation", observations[Number(select.value)]);
function show(event) {
    rows.push(event);
    if (event.type === "options")
        json("options", event.options);
    if (event.type === "blocks")
        blocks(event.blocks);
    if (event.type === "tools")
        json("tool-status", event.tools);
    if (event.type === "authoritative")
        renderMarkdown(get("authoritative"), event.text);
    if (event.type === "result") {
        json("result", event.value);
        json("structured", event.structured);
    }
    if (event.type === "observation") {
        observations.push(event.record);
        const option = document.createElement("option");
        option.value = String(observations.length - 1);
        option.textContent = `${event.record.sequence} · ${event.record.atMs} ms · ${event.record.kind}`;
        select.append(option);
        select.value = option.value;
        json("selected-observation", event.record);
    }
    if (event.type === "evidence") {
        json("evidence", event);
        complete = true;
    }
    if (event.type === "error") {
        get("status").textContent = event.text;
    }
}
run.onclick = async () => {
    rows.length = 0;
    observations.length = 0;
    complete = false;
    select.replaceChildren();
    get("conversation").replaceChildren();
    get("authoritative").replaceChildren();
    for (const id of [
        "options",
        "tool-status",
        "result",
        "structured",
        "block-data",
        "evidence",
        "selected-observation",
    ])
        json(id, {});
    get("delta-count").textContent = "0";
    get("status").textContent = "Running real SDK query…";
    run.disabled = true;
    try {
        const response = await fetch("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: get("mode").value }),
        });
        if (!response.ok || !response.body)
            throw new Error(await response.text());
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let pending = "";
        while (true) {
            const { value, done } = await reader.read();
            pending += decoder.decode(value, { stream: !done });
            let boundary;
            while ((boundary = pending.indexOf("\n\n")) >= 0) {
                const frame = pending.slice(0, boundary);
                pending = pending.slice(boundary + 2);
                if (frame.startsWith("data: "))
                    show(JSON.parse(frame.slice(6)));
            }
            if (done)
                break;
        }
        if (complete)
            get("status").textContent = "Complete · actual SDK evidence ready";
    }
    catch (error) {
        get("status").textContent =
            error instanceof Error ? error.message : "Run failed.";
    }
    finally {
        run.disabled = false;
    }
};
get("download").onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "lesson36-actual-events.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const response = await fetch("/api/config");
const config = await response.json();
run.disabled = !config.ready;
get("configuration").textContent = config.ready
    ? `Model: ${config.model} · SDK ${config.typescriptVersion} · private key configured on server`
    : "Configure the model key in .env and restart. See How to run.";
