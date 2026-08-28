---
name: multimodal-task-graph
description: Planeja e encadeia tarefas multimodais do Hermes com o grafo HuggingGPT e tokens <GENERATED>-N.
---

# Grafo de tarefas multimodais

Use este skill quando o pedido misturar texto, imagem, áudio ou vídeo, ou quando uma ferramenta precisar da saída de outra.

## Esquema

Responda o plano neste JSON antes de chamar ferramentas:

```json
{
  "task": [
    {
      "task": "image-generation | image-editing | visual-question-answering | video-generation | text-to-speech | speech-to-text | text-generation",
      "id": 0,
      "dep": [-1],
      "args": { "prompt": "...", "image": "<GENERATED>-0" }
    }
  ]
}
```

- `dep: [-1]` = sem dependência.
- `dep: [0]` = espera a tarefa `id` 0.
- Saída da tarefa N entra nas próximas como `<GENERATED>-N`.

## Mapa Hermes

| task | ferramenta Hermes |
| --- | --- |
| image-generation | `image_generate` |
| visual-question-answering | `vision_analyze` |
| video-generation | `video_generate` |
| video-qa | `video_analyze` |
| text-to-speech | `text_to_speech` |
| speech-to-text | transcrição / STT já configurado |

Não baixe pesos do microsoft-JARVIS. Não invente runtime Python 3.8. Encadeie só as tools do Hermes.

## Convenção `<GENERATED>-N`

Se a tarefa 0 gera uma imagem, a tarefa 1 usa `"image": "<GENERATED>-0"`. Nunca peça ao usuário o arquivo intermediário se ele já foi gerado neste turno.
