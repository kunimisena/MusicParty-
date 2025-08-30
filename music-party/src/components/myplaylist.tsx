import {
  Text,
  Skeleton,
  Stack,
  Accordion,
  useToast,
  Flex,
  Button,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
} from "@chakra-ui/react";
import { ChevronDownIcon } from '@chakra-ui/icons';
import { useEffect, useState } from "react";
import * as api from "../api/api";
import { toastError } from "../utils/toast";
import { Playlist } from "./playlist";

export const MyPlaylist = (props: {
  apis: string[];
  enqueue: (id: string, apiName: string) => void;
}) => {
  const [canshow, setCanshow] = useState(false);
  const [playlists, setPlaylists] = useState<api.Playlist[]>([]);
  const [needBind, setNeedBind] = useState(false);
  const [apiName, setApiName] = useState("");
  const [playlistCache, setPlaylistCache] = useState<
    Map<string, api.Playlist[]>
  >(new Map<string, api.Playlist[]>());
  const [someHook, setSomeHook] = useState(0);
  const [apis, setApis] = useState<string[]>([]);
  const t = useToast();

  useEffect(() => {
    api.getBindInfo().then((info: { key: string; value: string }[]) => {
      const apiNames = info.map((x) => x.key);
      setApis(info.map((x) => x.key));
      if (info.length > 0) {
        // 从 localStorage 读取上次选择的 apiName
        const storedApiName = localStorage.getItem('myPlaylistApiName');
        if (storedApiName && apiNames.includes(storedApiName)) {
          setApiName(storedApiName);
        } else {
          setApiName(info[0].key);
        }
      } else {
        setNeedBind(true);
        setCanshow(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!apiName) return;
    if (playlistCache.has(apiName)) {
      setPlaylists(playlistCache.get(apiName)!);
      setSomeHook((n) => n + 1);
    } else {
      setCanshow(false); 
      api
        .getMyPlaylist(apiName)
        .then((resp) => {
          setPlaylists(resp);
          setSomeHook((n) => n + 1);
          setPlaylistCache((c) => c.set(apiName, resp));
        })
        .catch((err) => {
          toastError(t, err.toString());
        })
        .finally(() => {
            setCanshow(true);
        });
    }
  }, [apiName, playlistCache, t]);

  return (
    <Stack>
      {needBind ? (
        <Text>请绑定你的音乐平台账户后刷新页面</Text>
      ) : (
        <>
          <Flex flexDirection={"row"} alignItems={"center"} mb={4}>
            <Text>选择平台</Text>
            <Menu>
              <MenuButton
                as={Button}
                rightIcon={<ChevronDownIcon />}
                ml={2}
                flex={1}
                textAlign="left"
                fontWeight="normal"
                bg="bg.3"
                color="text.2" // [核心修复] 为按钮本身指定二级字体颜色
                _hover={{ bg: 'bg.2' }}
                _active={{ bg: 'bg.2' }}
              >
                {apiName || '...'}
              </MenuButton>
              <MenuList>
                {apis.map((a) => (
                  <MenuItem 
                    key={a}
                    onClick={() => {
                      setApiName(a);
                      // 将新的 apiName 保存到 localStorage
                      localStorage.setItem('myPlaylistApiName', a);
                    }}
                  >
                    {a}
                  </MenuItem>
                ))}
              </MenuList>
            </Menu>
          </Flex>
          {canshow ? (
            <Accordion allowMultiple key={someHook}>
              {playlists.map((p) => (
                <Playlist
                  key={p.id}
                  id={p.id}
                  name={p.name}
                  apiName={apiName}
                  enqueue={props.enqueue}
                />
              ))}
            </Accordion>
          ) : (
             <>
                <Skeleton height="50px" />
                <Skeleton height="50px" />
                <Skeleton height="50px" />
                <Skeleton height="50px" />
            </>
          )}
        </>
      )}
    </Stack>
  );
};

