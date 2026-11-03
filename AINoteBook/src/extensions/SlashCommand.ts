import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { exitSuggestion } from '@tiptap/suggestion'
import {
  SlashMenu,
  type SlashMenuHandle,
  type SlashMenuProps,
} from '../components/Editor/SlashMenu'
import { filterSlashItems, type SlashItem } from '../lib/slashCommands'
import { useUiStore } from '../store/useUiStore'

export const slashPluginKey = new PluginKey('slashCommand')

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        pluginKey: slashPluginKey,
        allowedPrefixes: [' '],
        allowSpaces: true,
        dismissOnOutsideClick: true,
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => {
          props.run(editor, range)
          if (props.opensEmbedPicker) {
            useUiStore.getState().openEmbedPicker(editor.state.selection.from)
          }
        },
        render: () => {
          let component: ReactRenderer<SlashMenuHandle> | null = null
          let wrapper: HTMLDivElement | null = null
          let rectProvider: (() => DOMRect | null) | null | undefined

          const place = () => {
            if (!wrapper || !rectProvider) return
            const rect = rectProvider()
            if (!rect) return

            wrapper.style.visibility = 'hidden'
            requestAnimationFrame(() => {
              if (!wrapper) return
              const box = wrapper.getBoundingClientRect()
              const margin = 8
              let left = rect.left
              let top = rect.bottom + 6

              if (left + box.width + margin > window.innerWidth) {
                left = window.innerWidth - box.width - margin
              }
              if (top + box.height + margin > window.innerHeight) {
                top = Math.max(margin, rect.top - box.height - 6)
              }

              wrapper.style.left = `${Math.max(margin, left)}px`
              wrapper.style.top = `${top}px`
              wrapper.style.visibility = 'visible'
            })
          }

          return {
            onStart: (props) => {
              wrapper = document.createElement('div')
              wrapper.className = 'slash-menu-layer'
              document.body.appendChild(wrapper)

              component = new ReactRenderer<SlashMenuHandle, SlashMenuProps>(SlashMenu, {
                editor: props.editor,
                props: {
                  items: props.items,
                  query: props.query,
                  command: props.command,
                },
              })
              wrapper.appendChild(component.element)
              rectProvider = props.clientRect
              place()
            },
            onUpdate: (props) => {
              component?.updateProps({
                items: props.items,
                query: props.query,
                command: props.command,
              })
              rectProvider = props.clientRect
              place()
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') {
                exitSuggestion(props.view, slashPluginKey)
                return true
              }
              return component?.ref?.onKeyDown(props.event) ?? false
            },
            onExit: () => {
              wrapper?.remove()
              component?.destroy()
              wrapper = null
              component = null
              rectProvider = undefined
            },
          }
        },
      }),
    ]
  },
})
