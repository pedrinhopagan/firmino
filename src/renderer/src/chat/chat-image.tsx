import { PhotoIcon, XMarkIcon } from "@heroicons/react/16/solid"
import { useQuery } from "@tanstack/react-query"
import { createContext, use, useState } from "react"
import { createPortal } from "react-dom"
import type { EngineClient } from "../engine-client"

/** The Engine client that loads images on this computer; the Markdown renderer's components cannot take props. */
export const ChatImageClient = createContext<EngineClient | null>(null)

/** The absolute path a source names on this computer: `/tmp/print.png` or `file:///tmp/print.png`. */
function localPath(src: string) {
  if (src.startsWith("/")) {
    return src
  }

  if (src.startsWith("file://")) {
    return decodeURIComponent(new URL(src).pathname)
  }

  return undefined
}

function ImageNotice({ alt, message }: { alt: string; message: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground" role="img" aria-label={alt}>
      <PhotoIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{message}</span>
    </span>
  )
}

/** An image in a reply or in a step of the work: one on this computer loads through the Engine, one on the web loads directly. */
export function ChatImage({ src, alt = "" }: { src: string; alt?: string }) {
  const path = localPath(src)

  if (path) {
    return <LocalImage path={path} alt={alt} />
  }

  return <ShownImage url={src} alt={alt} />
}

function LocalImage({ path, alt }: { path: string; alt: string }) {
  const client = use(ChatImageClient)
  const image = useQuery({
    queryKey: ["conversation", "image", path],
    queryFn: async () => {
      if (!client) {
        throw new Error("o chat não tem acesso ao Engine")
      }

      // ponytail: each image's object URL lives until the window reloads; the chat shows few images.
      return URL.createObjectURL(await client.conversation.image({ path }))
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  })

  if (image.error) {
    return <ImageNotice alt={alt} message={`Não foi possível abrir a imagem: ${image.error.message}`} />
  }

  if (!image.data) {
    return <span className="block h-32 w-48 max-w-full animate-pulse rounded-md bg-muted" role="img" aria-label={alt} />
  }

  return <ShownImage url={image.data} alt={alt} />
}

/** A click opens the image over the window, as T3 Code's expanded image. */
function ShownImage({ url, alt }: { url: string; alt: string }) {
  const [broken, setBroken] = useState(false)
  const [expanded, setExpanded] = useState(false)

  if (broken) {
    return <ImageNotice alt={alt} message="Não foi possível abrir a imagem" />
  }

  return (
    <>
      <button type="button" className="block max-w-full cursor-zoom-in rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={alt ? `Ampliar ${alt}` : "Ampliar imagem"} onClick={() => setExpanded(true)}>
        <img className="max-h-72 max-w-full rounded-md border object-contain" src={url} alt={alt} loading="lazy" onError={() => setBroken(true)} />
      </button>
      {expanded && createPortal(<ExpandedImage url={url} alt={alt} onClose={() => setExpanded(false)} />, document.body)}
    </>
  )
}

/** The image fitted to the window; a click shows it at full size, and Esc or a click outside closes it. */
function ExpandedImage({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  const [fullSize, setFullSize] = useState(false)

  function open(dialog: HTMLDialogElement | null) {
    dialog?.showModal()
  }

  return (
    <dialog ref={open} className="m-0 grid h-dvh max-h-none w-dvw max-w-none place-items-center bg-transparent p-4 backdrop:bg-black/70" aria-label={alt || "Imagem"} onClose={onClose} onClick={(event) => event.target === event.currentTarget && event.currentTarget.close()}>
      <div className={`max-h-full max-w-full ${fullSize ? "overflow-auto" : ""}`}>
        <img className={`rounded-md ${fullSize ? "max-w-none cursor-zoom-out" : "max-h-[calc(100dvh-2rem)] max-w-[calc(100dvw-2rem)] cursor-zoom-in object-contain"}`} src={url} alt={alt} onClick={() => setFullSize(!fullSize)} />
      </div>
      <button type="button" className="fixed top-3 right-3 grid size-8 place-items-center rounded-md bg-black/50 text-white outline-none hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white" aria-label="Fechar" onClick={onClose}>
        <XMarkIcon className="size-4" aria-hidden="true" />
      </button>
    </dialog>
  )
}
