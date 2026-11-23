<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

const props = defineProps<{ id: string; graph: string }>();
const svg = ref("");
let observer: MutationObserver | undefined;

async function draw() {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
    layout: "dagre",
    look: "classic",
    flowchart: { wrappingWidth: 200 }
  });
  svg.value = (await mermaid.render(props.id, decodeURIComponent(props.graph))).svg;
}

onMounted(() => {
  observer = new MutationObserver(draw);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  void draw();
});

onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div class="mermaid" v-html="svg" />
</template>
